import { Router } from 'express';
import { ADMINISTRADORES, requiereRol, requiereSesion } from '../lib/auth.js';
import { asincrono, validarCuerpo, z } from '../lib/validacion.js';
import { abonarCompra, anularCompra, crearCompra, listarCompras, obtenerCompra } from '../modules/compras.js';

export const rutasCompras = Router();
rutasCompras.use(requiereSesion);

const esquemaPago = z.object({
  metodo: z.string().min(1).max(30),
  montoUsd: z.number().positive(),
  referencia: z.string().max(100).optional(),
});

const esquemaCompra = z.object({
  proveedorId: z.number().int().positive().nullable().optional(),
  sucursalId: z.number().int().positive().optional(),
  documentoProveedor: z.string().max(60).optional(),
  condicion: z.enum(['CONTADO', 'CREDITO']).default('CONTADO'),
  diasCredito: z.number().int().min(0).max(365).optional(),
  nota: z.string().max(500).optional(),
  lineas: z
    .array(
      z.object({
        productoId: z.number().int().positive(),
        cantidad: z.number().positive(),
        costoUsd: z.number().nonnegative(),
        ivaTasa: z.number().min(0).max(100).optional(),
      }),
    )
    .min(1, 'La compra necesita al menos una linea'),
  pagos: z.array(esquemaPago).default([]),
});

rutasCompras.get(
  '/',
  asincrono(async (req, res) => {
    const q = z
      .object({
        desde: z.string().optional(),
        hasta: z.string().optional(),
        proveedorId: z.coerce.number().int().positive().optional(),
        estado: z.enum(['EMITIDA', 'ANULADA']).optional(),
        soloPendientes: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
        pagina: z.coerce.number().int().min(1).default(1),
        porPagina: z.coerce.number().int().min(1).max(200).default(25),
      })
      .parse(req.query);
    res.json(await listarCompras(q));
  }),
);

rutasCompras.get(
  '/:id',
  asincrono(async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    res.json(await obtenerCompra(id));
  }),
);

rutasCompras.post(
  '/',
  requiereRol(...ADMINISTRADORES, 'ALMACEN'),
  validarCuerpo(esquemaCompra),
  asincrono(async (req, res) => {
    res.status(201).json(await crearCompra(req.body as z.infer<typeof esquemaCompra>, req.sesion!));
  }),
);

rutasCompras.post(
  '/:id/abono',
  requiereRol(...ADMINISTRADORES, 'CONTADOR'),
  validarCuerpo(esquemaPago),
  asincrono(async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    res.json(await abonarCompra(id, req.body as z.infer<typeof esquemaPago>, req.sesion!));
  }),
);

rutasCompras.post(
  '/:id/anular',
  requiereRol(...ADMINISTRADORES),
  validarCuerpo(z.object({ motivo: z.string().min(3).max(300) })),
  asincrono(async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    res.json(await anularCompra(id, (req.body as { motivo: string }).motivo, req.sesion!));
  }),
);
