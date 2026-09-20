import { Router } from 'express';
import { uno } from '../lib/db.js';
import { firmarToken, hashearClave, requiereSesion, verificarClave, type Sesion } from '../lib/auth.js';
import { noAutenticado, solicitudInvalida } from '../lib/errores.js';
import { asincrono, validarCuerpo, z } from '../lib/validacion.js';

export const rutasAuth = Router();

const esquemaLogin = z.object({
  email: z.string().email('Correo invalido'),
  password: z.string().min(1, 'La clave es obligatoria'),
});

rutasAuth.post(
  '/login',
  validarCuerpo(esquemaLogin),
  asincrono(async (req, res) => {
    const { email, password } = req.body as z.infer<typeof esquemaLogin>;
    const usuario = await uno<{
      id: number; email: string; nombre: string; password_hash: string;
      rol: Sesion['rol']; sucursal_id: number | null; activo: boolean;
    }>('SELECT id, email, nombre, password_hash, rol, sucursal_id, activo FROM usuario WHERE lower(email) = lower($1)', [email]);

    // Mismo mensaje para usuario inexistente y clave errada: no revelamos cuales correos existen.
    if (!usuario || !usuario.activo) throw noAutenticado();
    if (!(await verificarClave(password, usuario.password_hash))) throw noAutenticado();

    await uno('UPDATE usuario SET ultimo_acceso = now() WHERE id = $1', [usuario.id]);

    const sesion: Sesion = {
      id: usuario.id,
      email: usuario.email,
      nombre: usuario.nombre,
      rol: usuario.rol,
      sucursalId: usuario.sucursal_id,
    };
    res.json({ token: firmarToken(sesion), usuario: sesion });
  }),
);

rutasAuth.get('/yo', requiereSesion, (req, res) => {
  res.json({ usuario: req.sesion });
});

const esquemaClave = z.object({
  actual: z.string().min(1),
  nueva: z.string().min(8, 'La nueva clave debe tener al menos 8 caracteres'),
});

rutasAuth.post(
  '/cambiar-clave',
  requiereSesion,
  validarCuerpo(esquemaClave),
  asincrono(async (req, res) => {
    const { actual, nueva } = req.body as z.infer<typeof esquemaClave>;
    const fila = await uno<{ password_hash: string }>('SELECT password_hash FROM usuario WHERE id = $1', [req.sesion!.id]);
    if (!fila || !(await verificarClave(actual, fila.password_hash))) {
      throw solicitudInvalida('La clave actual no es correcta');
    }
    await uno('UPDATE usuario SET password_hash = $2 WHERE id = $1', [req.sesion!.id, await hashearClave(nueva)]);
    res.json({ ok: true });
  }),
);
