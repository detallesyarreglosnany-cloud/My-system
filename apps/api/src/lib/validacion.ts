import type { NextFunction, Request, Response } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { solicitudInvalida } from './errores.js';

export { z };

export function validar<T extends ZodTypeAny>(esquema: T, valor: unknown): z.infer<T> {
  const r = esquema.safeParse(valor);
  if (!r.success) {
    throw solicitudInvalida(
      'Datos invalidos',
      r.error.issues.map((i) => ({ campo: i.path.join('.') || '(raiz)', mensaje: i.message })),
    );
  }
  return r.data;
}

/** Middleware: valida `req.body` y lo reemplaza por el valor parseado. */
export function validarCuerpo<T extends ZodTypeAny>(esquema: T) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.body = validar(esquema, req.body);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const idParam = z.coerce.number().int().positive();

export const paginacion = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(200).default(25),
});

/** Envuelve un handler async para que los rechazos lleguen al manejador de errores. */
export function asincrono<R extends Request = Request>(
  fn: (req: R, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as R, res, next)).catch(next);
  };
}
