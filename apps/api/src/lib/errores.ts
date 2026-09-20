export class ErrorHttp extends Error {
  constructor(
    public readonly estado: number,
    mensaje: string,
    public readonly detalles?: unknown,
  ) {
    super(mensaje);
    this.name = 'ErrorHttp';
  }
}

export const solicitudInvalida = (m: string, d?: unknown) => new ErrorHttp(400, m, d);
export const noAutenticado = (m = 'Credenciales invalidas o sesion expirada') => new ErrorHttp(401, m);
export const sinPermiso = (m = 'No tienes permiso para esta accion') => new ErrorHttp(403, m);
export const noEncontrado = (m = 'Recurso no encontrado') => new ErrorHttp(404, m);
export const conflicto = (m: string, d?: unknown) => new ErrorHttp(409, m, d);
