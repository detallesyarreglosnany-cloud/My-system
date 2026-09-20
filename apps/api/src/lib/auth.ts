import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { env } from './env.js';
import { noAutenticado, sinPermiso } from './errores.js';

export type Rol = 'PROPIETARIO' | 'ADMIN' | 'VENDEDOR' | 'ALMACEN' | 'CONTADOR';

export interface Sesion {
  id: number;
  email: string;
  nombre: string;
  rol: Rol;
  sucursalId: number | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      sesion?: Sesion;
    }
  }
}

export const hashearClave = (clave: string) => bcrypt.hash(clave, 10);
export const verificarClave = (clave: string, hash: string) => bcrypt.compare(clave, hash);

export function firmarToken(sesion: Sesion): string {
  return jwt.sign(sesion, env.jwtSecret, { expiresIn: env.jwtExpiraEn } as jwt.SignOptions);
}

export function verificarToken(token: string): Sesion {
  try {
    const carga = jwt.verify(token, env.jwtSecret) as jwt.JwtPayload & Sesion;
    return { id: carga.id, email: carga.email, nombre: carga.nombre, rol: carga.rol, sucursalId: carga.sucursalId ?? null };
  } catch {
    throw noAutenticado();
  }
}

/** Exige un token valido y deja la sesion en `req.sesion`. */
export function requiereSesion(req: Request, _res: Response, next: NextFunction) {
  const cabecera = req.header('authorization') ?? '';
  const [esquema, token] = cabecera.split(' ');
  if (esquema !== 'Bearer' || !token) return next(noAutenticado('Falta el token de acceso'));
  try {
    req.sesion = verificarToken(token);
    next();
  } catch (error) {
    next(error);
  }
}

/** Exige que la sesion tenga alguno de los roles indicados. */
export function requiereRol(...roles: Rol[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.sesion) return next(noAutenticado());
    if (!roles.includes(req.sesion.rol)) return next(sinPermiso(`Requiere rol: ${roles.join(', ')}`));
    next();
  };
}

export const ADMINISTRADORES: Rol[] = ['PROPIETARIO', 'ADMIN'];
