/**
 * Punto de entrada para Vercel.
 *
 * La misma aplicacion Express que corre en Docker se expone aqui como funcion
 * serverless. El SPA no pasa por aqui: Vercel lo sirve desde su CDN, y solo las
 * rutas /api/* llegan a esta funcion.
 */
import { crearApp } from '../apps/api/dist/app.js';

const app = crearApp();

export default function handler(peticion, respuesta) {
  // Segun como Vercel aplique la reescritura, la URL puede llegar con o sin el
  // prefijo /api. Se normaliza para que el enrutado de Express siempre calce.
  if (!peticion.url || !peticion.url.startsWith('/api')) {
    peticion.url = `/api${peticion.url ?? '/'}`;
  }
  return app(peticion, respuesta);
}
