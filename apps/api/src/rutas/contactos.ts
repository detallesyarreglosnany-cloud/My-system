import { Router } from 'express';
import { consultar, uno } from '../lib/db.js';
import { ADMINISTRADORES, requiereRol, requiereSesion } from '../lib/auth.js';
import { conflicto, noEncontrado } from '../lib/errores.js';
import { asincrono, validarCuerpo, z } from '../lib/validacion.js';

const TIPOS_DOCUMENTO = ['V', 'E', 'J', 'G', 'P'] as const;

const esquemaBase = {
  tipoDocumento: z.enum(TIPOS_DOCUMENTO),
  documento: z.string().min(1).max(20),
  nombre: z.string().min(1).max(200),
  email: z.string().email().or(z.literal('')).default(''),
  telefono: z.string().max(40).default(''),
  direccion: z.string().max(400).default(''),
  activo: z.boolean().default(true),
};

const esquemaCliente = z.object({
  ...esquemaBase,
  tipoDocumento: z.enum(TIPOS_DOCUMENTO).default('V'),
  limiteCreditoUsd: z.number().min(0).default(0),
  diasCredito: z.number().int().min(0).max(365).default(0),
});

const esquemaProveedor = z.object({
  ...esquemaBase,
  tipoDocumento: z.enum(TIPOS_DOCUMENTO).default('J'),
});

/**
 * Clientes y proveedores comparten forma; se genera un router para cada tabla
 * con la unica diferencia de las columnas de credito.
 */
function construirRouter(tabla: 'cliente' | 'proveedor') {
  const router = Router();
  router.use(requiereSesion);
  const esCliente = tabla === 'cliente';
  const esquema = esCliente ? esquemaCliente : esquemaProveedor;
  const columnasSaldo = esCliente
    ? `COALESCE((SELECT SUM(saldo_usd) FROM venta WHERE cliente_id = t.id AND estado='EMITIDA' AND saldo_usd > 0.005), 0) AS saldo_usd`
    : `COALESCE((SELECT SUM(saldo_usd) FROM compra WHERE proveedor_id = t.id AND estado='EMITIDA' AND saldo_usd > 0.005), 0) AS saldo_usd`;

  router.get(
    '/',
    asincrono(async (req, res) => {
      const q = z
        .object({
          texto: z.string().optional(),
          soloActivos: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
          conSaldo: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
          pagina: z.coerce.number().int().min(1).default(1),
          porPagina: z.coerce.number().int().min(1).max(500).default(50),
        })
        .parse(req.query);

      const condiciones = ['1=1'];
      const params: unknown[] = [];
      if (q.soloActivos) condiciones.push('t.activo');
      if (q.texto) {
        params.push(`%${q.texto}%`);
        condiciones.push(`(t.nombre ILIKE $${params.length} OR t.documento ILIKE $${params.length} OR t.email ILIKE $${params.length})`);
      }
      const donde = condiciones.join(' AND ');
      const offset = (q.pagina - 1) * q.porPagina;
      const teniendo = q.conSaldo ? 'WHERE saldo_usd > 0.005' : '';

      const datos = await consultar(
        `SELECT * FROM (
           SELECT t.*, ${columnasSaldo} FROM ${tabla} t WHERE ${donde}
         ) x ${teniendo}
         ORDER BY nombre LIMIT ${q.porPagina} OFFSET ${offset}`,
        params,
      );
      const total = await uno<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${tabla} t WHERE ${donde}`, params);
      res.json({ datos, total: total?.n ?? 0, pagina: q.pagina, porPagina: q.porPagina });
    }),
  );

  router.get(
    '/:id',
    asincrono(async (req, res) => {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const fila = await uno(`SELECT t.*, ${columnasSaldo} FROM ${tabla} t WHERE t.id = $1`, [id]);
      if (!fila) throw noEncontrado(`El ${tabla} no existe`);
      const documentos = esCliente
        ? await consultar(
            `SELECT id, numero, fecha, total_usd, saldo_usd, estado, condicion, vence_el
               FROM venta WHERE cliente_id = $1 ORDER BY fecha DESC LIMIT 50`,
            [id],
          )
        : await consultar(
            `SELECT id, numero, fecha, total_usd, saldo_usd, estado, condicion, vence_el
               FROM compra WHERE proveedor_id = $1 ORDER BY fecha DESC LIMIT 50`,
            [id],
          );
      res.json({ ...fila, documentos });
    }),
  );

  router.post(
    '/',
    requiereRol(...ADMINISTRADORES, 'VENDEDOR', 'ALMACEN'),
    validarCuerpo(esquema),
    asincrono(async (req, res) => {
      const d = req.body as any;
      const duplicado = await uno(`SELECT id FROM ${tabla} WHERE tipo_documento = $1 AND documento = $2`, [
        d.tipoDocumento,
        d.documento,
      ]);
      if (duplicado) throw conflicto(`Ya existe un registro con el documento ${d.tipoDocumento}-${d.documento}`);

      const columnas = ['tipo_documento', 'documento', 'nombre', 'email', 'telefono', 'direccion', 'activo'];
      const valores: unknown[] = [d.tipoDocumento, d.documento, d.nombre, d.email, d.telefono, d.direccion, d.activo];
      if (esCliente) {
        columnas.push('limite_credito_usd', 'dias_credito');
        valores.push(d.limiteCreditoUsd, d.diasCredito);
      }
      const marcadores = valores.map((_, i) => `$${i + 1}`).join(',');
      const creado = await uno(`INSERT INTO ${tabla} (${columnas.join(',')}) VALUES (${marcadores}) RETURNING *`, valores);
      res.status(201).json(creado);
    }),
  );

  router.put(
    '/:id',
    requiereRol(...ADMINISTRADORES, 'VENDEDOR'),
    validarCuerpo(
      z
        .object({
          tipoDocumento: z.enum(TIPOS_DOCUMENTO),
          documento: z.string().min(1).max(20),
          nombre: z.string().min(1).max(200),
          email: z.string().email().or(z.literal('')),
          telefono: z.string().max(40),
          direccion: z.string().max(400),
          activo: z.boolean(),
          limiteCreditoUsd: z.number().min(0),
          diasCredito: z.number().int().min(0).max(365),
        })
        .partial(),
    ),
    asincrono(async (req, res) => {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const d = req.body as Record<string, unknown>;
      const mapa: Record<string, unknown> = {
        tipo_documento: d.tipoDocumento, documento: d.documento, nombre: d.nombre,
        email: d.email, telefono: d.telefono, direccion: d.direccion, activo: d.activo,
      };
      if (esCliente) {
        mapa.limite_credito_usd = d.limiteCreditoUsd;
        mapa.dias_credito = d.diasCredito;
      }
      const columnas = Object.entries(mapa).filter(([, v]) => v !== undefined);
      if (columnas.length === 0) throw conflicto('No hay cambios que aplicar');
      const asignaciones = columnas.map(([c], i) => `${c} = $${i + 2}`).join(', ');
      const actualizado = await uno(`UPDATE ${tabla} SET ${asignaciones} WHERE id = $1 RETURNING *`, [
        id,
        ...columnas.map(([, v]) => v),
      ]);
      if (!actualizado) throw noEncontrado(`El ${tabla} no existe`);
      res.json(actualizado);
    }),
  );

  return router;
}

export const rutasClientes = construirRouter('cliente');
export const rutasProveedores = construirRouter('proveedor');
