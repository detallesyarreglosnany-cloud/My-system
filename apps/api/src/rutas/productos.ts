import { Router } from 'express';
import { consultar, enTransaccion, uno } from '../lib/db.js';
import { ADMINISTRADORES, requiereRol, requiereSesion } from '../lib/auth.js';
import { conflicto, noEncontrado } from '../lib/errores.js';
import { asincrono, validarCuerpo, z } from '../lib/validacion.js';
import { aplicarMovimiento, existenciaActual, stockBajo, transferir } from '../modules/inventario.js';
import { registrarAuditoria } from '../modules/ventas.js';

export const rutasProductos = Router();
rutasProductos.use(requiereSesion);

const esquemaProducto = z.object({
  sku: z.string().min(1).max(40),
  codigoBarras: z.string().max(60).optional().nullable(),
  nombre: z.string().min(1).max(200),
  descripcion: z.string().max(1000).default(''),
  categoriaId: z.number().int().positive().nullable().optional(),
  tipo: z.enum(['BIEN', 'SERVICIO']).default('BIEN'),
  unidad: z.string().max(10).default('UND'),
  precioUsd: z.number().nonnegative(),
  costoUsd: z.number().nonnegative().default(0),
  ivaTasa: z.number().min(0).max(100).default(16),
  stockMinimo: z.number().min(0).default(0),
  activo: z.boolean().default(true),
});

// En la actualizacion no se aplican valores por defecto: solo se tocan las
// columnas que el cliente envia explicitamente.
const esquemaProductoActualizar = z.object({
  sku: z.string().min(1).max(40),
  codigoBarras: z.string().max(60).nullable(),
  nombre: z.string().min(1).max(200),
  descripcion: z.string().max(1000),
  categoriaId: z.number().int().positive().nullable(),
  tipo: z.enum(['BIEN', 'SERVICIO']),
  unidad: z.string().max(10),
  precioUsd: z.number().nonnegative(),
  costoUsd: z.number().nonnegative(),
  ivaTasa: z.number().min(0).max(100),
  stockMinimo: z.number().min(0),
  activo: z.boolean(),
}).partial();

rutasProductos.get(
  '/',
  asincrono(async (req, res) => {
    const q = z
      .object({
        texto: z.string().optional(),
        categoriaId: z.coerce.number().int().positive().optional(),
        sucursalId: z.coerce.number().int().positive().optional(),
        soloActivos: z
          .enum(['true', 'false'])
          .default('true')
          .transform((v) => v === 'true'),
        pagina: z.coerce.number().int().min(1).default(1),
        porPagina: z.coerce.number().int().min(1).max(500).default(50),
      })
      .parse(req.query);

    const condiciones: string[] = ['1=1'];
    const params: unknown[] = [];
    if (q.soloActivos) condiciones.push('p.activo');
    if (q.texto) {
      params.push(`%${q.texto}%`);
      condiciones.push(`(p.nombre ILIKE $${params.length} OR p.sku ILIKE $${params.length} OR p.codigo_barras ILIKE $${params.length})`);
    }
    if (q.categoriaId) {
      params.push(q.categoriaId);
      condiciones.push(`p.categoria_id = $${params.length}`);
    }
    params.push(q.sucursalId ?? null);
    const filtroSucursal = `$${params.length}`;

    const donde = condiciones.join(' AND ');
    const offset = (q.pagina - 1) * q.porPagina;

    const datos = await consultar(
      `SELECT p.*, c.nombre AS categoria_nombre,
              COALESCE(SUM(e.cantidad) FILTER (WHERE ${filtroSucursal}::int IS NULL OR e.sucursal_id = ${filtroSucursal}::int), 0) AS existencia
         FROM producto p
         LEFT JOIN categoria c ON c.id = p.categoria_id
         LEFT JOIN existencia e ON e.producto_id = p.id
        WHERE ${donde}
        GROUP BY p.id, c.nombre
        ORDER BY p.nombre
        LIMIT ${q.porPagina} OFFSET ${offset}`,
      params,
    );
    const total = await uno<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM producto p WHERE ${donde}`,
      params.slice(0, params.length - 1),
    );
    res.json({ datos, total: total?.n ?? 0, pagina: q.pagina, porPagina: q.porPagina });
  }),
);

rutasProductos.get(
  '/alertas/stock-bajo',
  asincrono(async (req, res) => {
    const { sucursalId } = z.object({ sucursalId: z.coerce.number().int().positive().optional() }).parse(req.query);
    res.json({ datos: await stockBajo(100, sucursalId) });
  }),
);

rutasProductos.get(
  '/:id',
  asincrono(async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const producto = await uno('SELECT p.*, c.nombre AS categoria_nombre FROM producto p LEFT JOIN categoria c ON c.id = p.categoria_id WHERE p.id = $1', [id]);
    if (!producto) throw noEncontrado('El producto no existe');
    const existencias = await consultar(
      `SELECT s.id AS sucursal_id, s.nombre AS sucursal, COALESCE(e.cantidad, 0) AS cantidad
         FROM sucursal s LEFT JOIN existencia e ON e.sucursal_id = s.id AND e.producto_id = $1
        WHERE s.activa ORDER BY s.id`,
      [id],
    );
    const movimientos = await consultar(
      `SELECT m.*, s.nombre AS sucursal, u.nombre AS usuario
         FROM movimiento_inventario m
         LEFT JOIN sucursal s ON s.id = m.sucursal_id
         LEFT JOIN usuario u ON u.id = m.usuario_id
        WHERE m.producto_id = $1 ORDER BY m.id DESC LIMIT 50`,
      [id],
    );
    res.json({ ...producto, existencias, movimientos });
  }),
);

rutasProductos.post(
  '/',
  requiereRol(...ADMINISTRADORES, 'ALMACEN'),
  validarCuerpo(esquemaProducto),
  asincrono(async (req, res) => {
    const p = req.body as z.infer<typeof esquemaProducto>;
    const existe = await uno('SELECT id FROM producto WHERE lower(sku) = lower($1)', [p.sku]);
    if (existe) throw conflicto(`Ya existe un producto con el SKU "${p.sku}"`);

    const creado = await uno(
      `INSERT INTO producto (sku, codigo_barras, nombre, descripcion, categoria_id, tipo, unidad,
                             precio_usd, costo_usd, iva_tasa, stock_minimo, activo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [p.sku, p.codigoBarras || null, p.nombre, p.descripcion, p.categoriaId ?? null, p.tipo, p.unidad,
       p.precioUsd, p.costoUsd, p.ivaTasa, p.stockMinimo, p.activo],
    );
    res.status(201).json(creado);
  }),
);

rutasProductos.put(
  '/:id',
  requiereRol(...ADMINISTRADORES, 'ALMACEN'),
  validarCuerpo(esquemaProductoActualizar),
  asincrono(async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const p = req.body as z.infer<typeof esquemaProductoActualizar>;
    const mapa: Record<string, unknown> = {
      sku: p.sku, codigo_barras: p.codigoBarras, nombre: p.nombre, descripcion: p.descripcion,
      categoria_id: p.categoriaId, tipo: p.tipo, unidad: p.unidad, precio_usd: p.precioUsd,
      costo_usd: p.costoUsd, iva_tasa: p.ivaTasa, stock_minimo: p.stockMinimo, activo: p.activo,
    };
    const columnas = Object.entries(mapa).filter(([, v]) => v !== undefined);
    if (columnas.length === 0) throw conflicto('No hay cambios que aplicar');

    const asignaciones = columnas.map(([c], i) => `${c} = $${i + 2}`).join(', ');
    const actualizado = await uno(
      `UPDATE producto SET ${asignaciones}, actualizado_en = now() WHERE id = $1 RETURNING *`,
      [id, ...columnas.map(([, v]) => v)],
    );
    if (!actualizado) throw noEncontrado('El producto no existe');
    res.json(actualizado);
  }),
);

const esquemaAjuste = z.object({
  sucursalId: z.number().int().positive(),
  /** Cantidad final deseada en esa sucursal. */
  cantidadFinal: z.number().min(0),
  nota: z.string().max(300).default('Ajuste manual'),
});

rutasProductos.post(
  '/:id/ajuste',
  requiereRol(...ADMINISTRADORES, 'ALMACEN'),
  validarCuerpo(esquemaAjuste),
  asincrono(async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const a = req.body as z.infer<typeof esquemaAjuste>;
    const resultado = await enTransaccion(async (cliente) => {
      const actual = await existenciaActual(cliente, id, a.sucursalId);
      const saldo = await aplicarMovimiento(cliente, {
        productoId: id,
        sucursalId: a.sucursalId,
        delta: a.cantidadFinal - actual,
        tipo: 'AJUSTE',
        referenciaTipo: 'AJUSTE',
        nota: a.nota,
        usuarioId: req.sesion!.id,
        permitirNegativo: false,
      });
      await registrarAuditoria(cliente, req.sesion!.id, 'INVENTARIO_AJUSTADO', 'producto', id, {
        sucursal_id: a.sucursalId, anterior: actual, nuevo: saldo,
      });
      return { anterior: actual, actual: saldo };
    });
    res.json(resultado);
  }),
);

const esquemaTransferencia = z.object({
  origenId: z.number().int().positive(),
  destinoId: z.number().int().positive(),
  cantidad: z.number().positive(),
  nota: z.string().max(300).optional(),
});

rutasProductos.post(
  '/:id/transferencia',
  requiereRol(...ADMINISTRADORES, 'ALMACEN'),
  validarCuerpo(esquemaTransferencia),
  asincrono(async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const t = req.body as z.infer<typeof esquemaTransferencia>;
    const resultado = await enTransaccion((cliente) =>
      transferir(cliente, { productoId: id, ...t, usuarioId: req.sesion!.id }),
    );
    res.json(resultado);
  }),
);
