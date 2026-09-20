import { Router } from 'express';
import { requiereSesion } from '../lib/auth.js';
import { asincrono, z } from '../lib/validacion.js';
import {
  antiguedadSaldos, libroDeVentas, resumen, topProductos,
  valorizacionInventario, ventasPorDia, ventasPorMetodo,
} from '../modules/reportes.js';

export const rutasReportes = Router();
rutasReportes.use(requiereSesion);

const rango = z.object({ desde: z.string().optional(), hasta: z.string().optional() });

rutasReportes.get('/resumen', asincrono(async (_req, res) => res.json(await resumen())));

rutasReportes.get(
  '/ventas-por-dia',
  asincrono(async (req, res) => {
    const { dias } = z.object({ dias: z.coerce.number().int().min(1).max(365).default(30) }).parse(req.query);
    res.json({ datos: await ventasPorDia(dias) });
  }),
);

rutasReportes.get(
  '/top-productos',
  asincrono(async (req, res) => {
    const q = rango.extend({ limite: z.coerce.number().int().min(1).max(100).default(10) }).parse(req.query);
    res.json({ datos: await topProductos(q.limite, q.desde, q.hasta) });
  }),
);

rutasReportes.get(
  '/ventas-por-metodo',
  asincrono(async (req, res) => {
    const q = rango.parse(req.query);
    res.json({ datos: await ventasPorMetodo(q.desde, q.hasta) });
  }),
);

rutasReportes.get(
  '/libro-ventas',
  asincrono(async (req, res) => {
    const hoy = new Date().toISOString().slice(0, 10);
    const primero = `${hoy.slice(0, 7)}-01`;
    const q = z.object({ desde: z.string().default(primero), hasta: z.string().default(hoy) }).parse(req.query);
    res.json(await libroDeVentas(q.desde, q.hasta));
  }),
);

rutasReportes.get(
  '/cuentas-por-cobrar',
  asincrono(async (_req, res) => res.json({ datos: await antiguedadSaldos('COBRAR') })),
);

rutasReportes.get(
  '/cuentas-por-pagar',
  asincrono(async (_req, res) => res.json({ datos: await antiguedadSaldos('PAGAR') })),
);

rutasReportes.get(
  '/inventario',
  asincrono(async (req, res) => {
    const { sucursalId } = z.object({ sucursalId: z.coerce.number().int().positive().optional() }).parse(req.query);
    res.json({ datos: await valorizacionInventario(sucursalId) });
  }),
);
