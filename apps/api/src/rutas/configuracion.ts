import { Router } from 'express';
import { consultar, uno } from '../lib/db.js';
import { ADMINISTRADORES, hashearClave, requiereRol, requiereSesion } from '../lib/auth.js';
import { conflicto, noEncontrado } from '../lib/errores.js';
import { asincrono, validarCuerpo, z } from '../lib/validacion.js';
import { guardarTasa, historicoTasas, sincronizarTasa, tasaVigente } from '../modules/tasa.js';

export const rutasConfiguracion = Router();
rutasConfiguracion.use(requiereSesion);

// ── Organizacion ────────────────────────────────────────────────────────────
rutasConfiguracion.get(
  '/organizacion',
  asincrono(async (_req, res) => {
    res.json(await uno('SELECT * FROM organizacion ORDER BY id LIMIT 1'));
  }),
);

rutasConfiguracion.put(
  '/organizacion',
  requiereRol(...ADMINISTRADORES),
  validarCuerpo(
    z
      .object({
        nombre: z.string().min(1).max(200),
        rif: z.string().min(1).max(20),
        direccion: z.string().max(400),
        telefono: z.string().max(40),
        email: z.string().email().or(z.literal('')),
        ivaTasa: z.number().min(0).max(100),
        igtfTasa: z.number().min(0).max(100),
      })
      .partial(),
  ),
  asincrono(async (req, res) => {
    const d = req.body as Record<string, unknown>;
    const mapa: Record<string, unknown> = {
      nombre: d.nombre, rif: d.rif, direccion: d.direccion,
      telefono: d.telefono, email: d.email, iva_tasa: d.ivaTasa, igtf_tasa: d.igtfTasa,
    };
    const columnas = Object.entries(mapa).filter(([, v]) => v !== undefined);
    if (columnas.length === 0) throw conflicto('No hay cambios que aplicar');
    const asignaciones = columnas.map(([c], i) => `${c} = $${i + 1}`).join(', ');
    res.json(
      await uno(
        `UPDATE organizacion SET ${asignaciones} WHERE id = (SELECT id FROM organizacion ORDER BY id LIMIT 1) RETURNING *`,
        columnas.map(([, v]) => v),
      ),
    );
  }),
);

// ── Sucursales ──────────────────────────────────────────────────────────────
rutasConfiguracion.get(
  '/sucursales',
  asincrono(async (_req, res) => res.json({ datos: await consultar('SELECT * FROM sucursal ORDER BY es_principal DESC, id') })),
);

rutasConfiguracion.post(
  '/sucursales',
  requiereRol(...ADMINISTRADORES),
  validarCuerpo(
    z.object({
      codigo: z.string().min(1).max(20),
      nombre: z.string().min(1).max(120),
      direccion: z.string().max(400).default(''),
      esPrincipal: z.boolean().default(false),
    }),
  ),
  asincrono(async (req, res) => {
    const s = req.body as { codigo: string; nombre: string; direccion: string; esPrincipal: boolean };
    if (await uno('SELECT id FROM sucursal WHERE lower(codigo) = lower($1)', [s.codigo])) {
      throw conflicto(`Ya existe una sucursal con el codigo "${s.codigo}"`);
    }
    if (s.esPrincipal) await uno('UPDATE sucursal SET es_principal = false');
    res.status(201).json(
      await uno('INSERT INTO sucursal (codigo, nombre, direccion, es_principal) VALUES ($1,$2,$3,$4) RETURNING *', [
        s.codigo, s.nombre, s.direccion, s.esPrincipal,
      ]),
    );
  }),
);

rutasConfiguracion.put(
  '/sucursales/:id',
  requiereRol(...ADMINISTRADORES),
  validarCuerpo(z.object({ nombre: z.string().min(1).max(120), direccion: z.string().max(400), activa: z.boolean() }).partial()),
  asincrono(async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const d = req.body as Record<string, unknown>;
    const columnas = Object.entries({ nombre: d.nombre, direccion: d.direccion, activa: d.activa }).filter(([, v]) => v !== undefined);
    if (columnas.length === 0) throw conflicto('No hay cambios que aplicar');
    const asignaciones = columnas.map(([c], i) => `${c} = $${i + 2}`).join(', ');
    const fila = await uno(`UPDATE sucursal SET ${asignaciones} WHERE id = $1 RETURNING *`, [id, ...columnas.map(([, v]) => v)]);
    if (!fila) throw noEncontrado('La sucursal no existe');
    res.json(fila);
  }),
);

// ── Categorias ──────────────────────────────────────────────────────────────
rutasConfiguracion.get(
  '/categorias',
  asincrono(async (_req, res) => res.json({ datos: await consultar('SELECT * FROM categoria ORDER BY nombre') })),
);

rutasConfiguracion.post(
  '/categorias',
  requiereRol(...ADMINISTRADORES, 'ALMACEN'),
  validarCuerpo(z.object({ nombre: z.string().min(1).max(80) })),
  asincrono(async (req, res) => {
    const { nombre } = req.body as { nombre: string };
    if (await uno('SELECT id FROM categoria WHERE lower(nombre) = lower($1)', [nombre])) {
      throw conflicto(`La categoria "${nombre}" ya existe`);
    }
    res.status(201).json(await uno('INSERT INTO categoria (nombre) VALUES ($1) RETURNING *', [nombre]));
  }),
);

// ── Metodos de pago ─────────────────────────────────────────────────────────
rutasConfiguracion.get(
  '/metodos-pago',
  asincrono(async (_req, res) =>
    res.json({ datos: await consultar('SELECT * FROM metodo_pago WHERE activo ORDER BY orden, nombre') }),
  ),
);

rutasConfiguracion.put(
  '/metodos-pago/:codigo',
  requiereRol(...ADMINISTRADORES),
  validarCuerpo(z.object({ activo: z.boolean().optional(), aplicaIgtf: z.boolean().optional() })),
  asincrono(async (req, res) => {
    const codigo = z.string().min(1).max(30).parse(req.params.codigo);
    const d = req.body as { activo?: boolean; aplicaIgtf?: boolean };
    const columnas = Object.entries({ activo: d.activo, aplica_igtf: d.aplicaIgtf }).filter(([, v]) => v !== undefined);
    if (columnas.length === 0) throw conflicto('No hay cambios que aplicar');
    const asignaciones = columnas.map(([c], i) => `${c} = $${i + 2}`).join(', ');
    const fila = await uno(`UPDATE metodo_pago SET ${asignaciones} WHERE codigo = $1 RETURNING *`, [
      codigo, ...columnas.map(([, v]) => v),
    ]);
    if (!fila) throw noEncontrado('El metodo de pago no existe');
    res.json(fila);
  }),
);

// ── Usuarios ────────────────────────────────────────────────────────────────
const ROLES = ['PROPIETARIO', 'ADMIN', 'VENDEDOR', 'ALMACEN', 'CONTADOR'] as const;

rutasConfiguracion.get(
  '/usuarios',
  requiereRol(...ADMINISTRADORES),
  asincrono(async (_req, res) =>
    res.json({
      datos: await consultar(
        `SELECT u.id, u.email, u.nombre, u.rol, u.sucursal_id, u.activo, u.ultimo_acceso, u.creado_en, s.nombre AS sucursal
           FROM usuario u LEFT JOIN sucursal s ON s.id = u.sucursal_id ORDER BY u.nombre`,
      ),
    }),
  ),
);

rutasConfiguracion.post(
  '/usuarios',
  requiereRol(...ADMINISTRADORES),
  validarCuerpo(
    z.object({
      email: z.string().email(),
      nombre: z.string().min(1).max(120),
      password: z.string().min(8, 'La clave debe tener al menos 8 caracteres'),
      rol: z.enum(ROLES),
      sucursalId: z.number().int().positive().nullable().optional(),
    }),
  ),
  asincrono(async (req, res) => {
    const u = req.body as { email: string; nombre: string; password: string; rol: (typeof ROLES)[number]; sucursalId?: number | null };
    if (await uno('SELECT id FROM usuario WHERE lower(email) = lower($1)', [u.email])) {
      throw conflicto('Ya existe un usuario con ese correo');
    }
    const fila = await uno(
      `INSERT INTO usuario (email, nombre, password_hash, rol, sucursal_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, email, nombre, rol, sucursal_id, activo`,
      [u.email.toLowerCase(), u.nombre, await hashearClave(u.password), u.rol, u.sucursalId ?? null],
    );
    res.status(201).json(fila);
  }),
);

rutasConfiguracion.put(
  '/usuarios/:id',
  requiereRol(...ADMINISTRADORES),
  validarCuerpo(
    z
      .object({
        nombre: z.string().min(1).max(120),
        rol: z.enum(ROLES),
        sucursalId: z.number().int().positive().nullable(),
        activo: z.boolean(),
        password: z.string().min(8),
      })
      .partial(),
  ),
  asincrono(async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const d = req.body as Record<string, any>;
    if (id === req.sesion!.id && d.activo === false) throw conflicto('No puedes desactivar tu propio usuario');

    const mapa: Record<string, unknown> = { nombre: d.nombre, rol: d.rol, sucursal_id: d.sucursalId, activo: d.activo };
    if (d.password) mapa.password_hash = await hashearClave(d.password);
    const columnas = Object.entries(mapa).filter(([, v]) => v !== undefined);
    if (columnas.length === 0) throw conflicto('No hay cambios que aplicar');
    const asignaciones = columnas.map(([c], i) => `${c} = $${i + 2}`).join(', ');
    const fila = await uno(
      `UPDATE usuario SET ${asignaciones} WHERE id = $1 RETURNING id, email, nombre, rol, sucursal_id, activo`,
      [id, ...columnas.map(([, v]) => v)],
    );
    if (!fila) throw noEncontrado('El usuario no existe');
    res.json(fila);
  }),
);

// ── Tasa de cambio ──────────────────────────────────────────────────────────
rutasConfiguracion.get(
  '/tasa',
  asincrono(async (_req, res) => res.json(await tasaVigente())),
);

rutasConfiguracion.get(
  '/tasa/historico',
  asincrono(async (_req, res) => res.json({ datos: await historicoTasas(90) })),
);

rutasConfiguracion.post(
  '/tasa',
  requiereRol(...ADMINISTRADORES, 'CONTADOR'),
  validarCuerpo(
    z.object({
      fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa el formato AAAA-MM-DD').optional(),
      valor: z.number().positive('La tasa debe ser mayor que cero'),
    }),
  ),
  asincrono(async (req, res) => {
    const { fecha, valor } = req.body as { fecha?: string; valor: number };
    res.json(await guardarTasa(fecha ?? new Date().toISOString().slice(0, 10), valor, 'MANUAL'));
  }),
);

rutasConfiguracion.post(
  '/tasa/sincronizar',
  requiereRol(...ADMINISTRADORES),
  asincrono(async (_req, res) => {
    const tasa = await sincronizarTasa();
    if (!tasa) throw conflicto('La sincronizacion automatica esta desactivada o la fuente no respondio');
    res.json(tasa);
  }),
);
