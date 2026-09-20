/** Cliente HTTP minimo con manejo de sesion y errores tipados. */

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';
const CLAVE_TOKEN = 'fina.token';

export interface DetalleError {
  campo: string;
  mensaje: string;
}

export class ErrorApi extends Error {
  constructor(
    public readonly estado: number,
    mensaje: string,
    public readonly detalles?: DetalleError[] | unknown,
  ) {
    super(mensaje);
    this.name = 'ErrorApi';
  }

  /** Mensaje listo para mostrar, incluyendo los errores de validacion. */
  get textoCompleto(): string {
    const lista = Array.isArray(this.detalles)
      ? (this.detalles as DetalleError[]).filter((d) => d?.mensaje).map((d) => `${d.campo}: ${d.mensaje}`)
      : [];
    return lista.length > 0 ? `${this.message} — ${lista.join('; ')}` : this.message;
  }
}

export const token = {
  leer: () => localStorage.getItem(CLAVE_TOKEN),
  guardar: (valor: string) => localStorage.setItem(CLAVE_TOKEN, valor),
  borrar: () => localStorage.removeItem(CLAVE_TOKEN),
};

type Metodo = 'GET' | 'POST' | 'PUT' | 'DELETE';

async function pedir<T>(metodo: Metodo, ruta: string, cuerpo?: unknown): Promise<T> {
  const cabeceras: Record<string, string> = {};
  const jwt = token.leer();
  if (jwt) cabeceras.authorization = `Bearer ${jwt}`;
  if (cuerpo !== undefined) cabeceras['content-type'] = 'application/json';

  let respuesta: Response;
  try {
    respuesta = await fetch(BASE + ruta, {
      method: metodo,
      headers: cabeceras,
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
  } catch {
    throw new ErrorApi(0, 'No se pudo contactar el servidor. Revisa tu conexion.');
  }

  if (respuesta.status === 204) return undefined as T;

  const texto = await respuesta.text();
  let datos: any = null;
  try {
    datos = texto ? JSON.parse(texto) : null;
  } catch {
    datos = null;
  }

  if (!respuesta.ok) {
    if (respuesta.status === 401) {
      token.borrar();
      // Deja que la app reaccione sin acoplar el cliente al router.
      window.dispatchEvent(new CustomEvent('fina:sesion-expirada'));
    }
    throw new ErrorApi(respuesta.status, datos?.error ?? `Error ${respuesta.status}`, datos?.detalles);
  }

  return datos as T;
}

export const api = {
  get: <T>(ruta: string) => pedir<T>('GET', ruta),
  post: <T>(ruta: string, cuerpo?: unknown) => pedir<T>('POST', ruta, cuerpo ?? {}),
  put: <T>(ruta: string, cuerpo?: unknown) => pedir<T>('PUT', ruta, cuerpo ?? {}),
  del: <T>(ruta: string) => pedir<T>('DELETE', ruta),
};

/** Construye un query string omitiendo valores vacios. */
export function consulta(parametros: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [clave, valor] of Object.entries(parametros)) {
    if (valor === undefined || valor === null || valor === '') continue;
    p.set(clave, String(valor));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}
