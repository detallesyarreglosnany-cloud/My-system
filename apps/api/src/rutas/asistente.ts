import { Router } from 'express';
import { requiereSesion } from '../lib/auth.js';
import { asincrono, validarCuerpo, z } from '../lib/validacion.js';
import { preguntar, sugerencias } from '../modules/asistente.js';

export const rutasAsistente = Router();
rutasAsistente.use(requiereSesion);

rutasAsistente.get('/sugerencias', asincrono(async (_req, res) => res.json({ datos: await sugerencias() })));

rutasAsistente.post(
  '/preguntar',
  validarCuerpo(z.object({ pregunta: z.string().min(2, 'Escribe una pregunta').max(500) })),
  asincrono(async (req, res) => {
    res.json(await preguntar((req.body as { pregunta: string }).pregunta));
  }),
);
