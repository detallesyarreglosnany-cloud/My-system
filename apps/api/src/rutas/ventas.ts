import { Router } from 'express';
import { ADMINISTRADORES, requiereRol, requiereSesion } from '../lib/auth.js';
import { asincrono, validarCuerpo, z } from '../lib/validacion.js';
import { abonarVenta, anularVenta, cotizarVenta, crearVenta, listarVentas, obtenerVenta } from '../modules/ventas.js';

export const rutasVentas = Router();
rutasVentas.use(requiereSesion);

const esquemaLinea = z.object({
  productoId: z.number().int().positive().nullable().optional(),
  descripcion: z.string().max(300).optional(),
  cantidad: z.number().positive(),
  precioUsd: z.number().nonnegative().optional(),
  descuentoUsd: z.number().min(0).optional(),
  ivaTasa: z.number().min(0).max(100).optional(),
});

const esquemaPago = z.object({
  metodo: z.string().min(1).max(30),
  montoUsd: z.number().positive(),
  referencia: z.string().max(100).optional(),
});

const esquemaVenta = z.object({
  sucursalId: z.number().int().positive().optional(),
  clienteId: z.number().int().positive().nullable().optional(),
  condicion: z.enum(['CONTADO', 'CREDITO']).default('CONTADO'),
  diasCredito: z.number().int().min(0).max(365).optional(),
  descuentoUsd: z.number().min(0).optional(),
  nota: z.string().max(500).optional(),
  lineas: z.array(esquemaLinea).min(1, 'La venta necesita al menos una linea'),
  pagos: z.array(esquemaPago).default([]),
});

rutasVentas.get(
  '/',
  asincrono(async (req, res) => {
    const q = z
      .object({
        desde: z.string().optional(),
        hasta: z.string().optional(),
        clienteId: z.coerce.number().int().positive().optional(),
        sucursalId: z.coerce.number().int().positive().optional(),
        estado: z.enum(['EMITIDA', 'ANULADA']).optional(),
        soloPendientes: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
        texto: z.string().optional(),
        pagina: z.coerce.number().int().min(1).default(1),
        porPagina: z.coerce.number().int().min(1).max(200).default(25),
      })
      .parse(req.query);
    res.json(await listarVentas(q));
  }),
);

rutasVentas.post(
  '/cotizar',
  validarCuerpo(esquemaVenta.partial({ condicion: true, pagos: true })),
  asincrono(async (req, res) => {
    res.json(await cotizarVenta(req.body as z.infer<typeof esquemaVenta>));
  }),
);

rutasVentas.get(
  '/:id',
  asincrono(async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    res.json(await obtenerVenta(id));
  }),
);

rutasVentas.post(
  '/',
  requiereRol(...ADMINISTRADORES, 'VENDEDOR'),
  validarCuerpo(esquemaVenta),
  asincrono(async (req, res) => {
    const venta = await crearVenta(req.body as z.infer<typeof esquemaVenta>, req.sesion!);
    res.status(201).json(venta);
  }),
);

rutasVentas.post(
  '/:id/abono',
  requiereRol(...ADMINISTRADORES, 'VENDEDOR', 'CONTADOR'),
  validarCuerpo(esquemaPago),
  asincrono(async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    res.json(await abonarVenta(id, req.body as z.infer<typeof esquemaPago>, req.sesion!));
  }),
);

rutasVentas.post(
  '/:id/anular',
  requiereRol(...ADMINISTRADORES),
  validarCuerpo(z.object({ motivo: z.string().min(3, 'Indica el motivo de la anulacion').max(300) })),
  asincrono(async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    res.json(await anularVenta(id, (req.body as { motivo: string }).motivo, req.sesion!));
  }),
);
