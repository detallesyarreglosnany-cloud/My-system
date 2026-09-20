import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { env } from './lib/env.js';
import { ErrorHttp } from './lib/errores.js';
import { pool } from './lib/db.js';
import { rutasAuth } from './rutas/auth.js';
import { rutasProductos } from './rutas/productos.js';
import { rutasClientes, rutasProveedores } from './rutas/contactos.js';
import { rutasVentas } from './rutas/ventas.js';
import { rutasCompras } from './rutas/compras.js';
import { rutasConfiguracion } from './rutas/configuracion.js';
import { rutasReportes } from './rutas/reportes.js';
import { rutasAsistente } from './rutas/asistente.js';

const aqui = dirname(fileURLToPath(import.meta.url));

export function crearApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use(
    cors({
      origin: env.corsOrigin === '*' ? true : env.corsOrigin.split(',').map((o) => o.trim()),
      credentials: false,
    }),
  );

  // Cabeceras de seguridad basicas, sin dependencias extra.
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  app.get('/api/salud', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true, servicio: 'fina-api', version: '1.0.0', entorno: env.nodeEnv });
    } catch (error) {
      res.status(503).json({ ok: false, error: 'base de datos no disponible' });
    }
  });

  app.use('/api/auth', rutasAuth);
  app.use('/api/productos', rutasProductos);
  app.use('/api/clientes', rutasClientes);
  app.use('/api/proveedores', rutasProveedores);
  app.use('/api/ventas', rutasVentas);
  app.use('/api/compras', rutasCompras);
  app.use('/api/configuracion', rutasConfiguracion);
  app.use('/api/reportes', rutasReportes);
  app.use('/api/asistente', rutasAsistente);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint no encontrado' }));

  // En produccion el mismo proceso sirve el SPA compilado, para que el
  // despliegue sea un solo contenedor si asi se prefiere.
  const estaticos = join(aqui, '..', 'publico');
  if (existsSync(estaticos)) {
    app.use(express.static(estaticos, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(join(estaticos, 'index.html')));
  }

  app.use(manejadorDeErrores);
  return app;
}

export function manejadorDeErrores(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ErrorHttp) {
    return res.status(error.estado).json({ error: error.message, detalles: error.detalles });
  }
  if (error instanceof ZodError) {
    return res.status(400).json({
      error: 'Datos invalidos',
      detalles: error.issues.map((i) => ({ campo: i.path.join('.') || '(raiz)', mensaje: i.message })),
    });
  }

  const pgError = error as { code?: string; constraint?: string; message?: string };
  if (pgError?.code === '23505') {
    return res.status(409).json({ error: 'Ya existe un registro con esos datos', detalles: pgError.constraint });
  }
  if (pgError?.code === '23503') {
    return res.status(409).json({ error: 'El registro esta referenciado por otro y no puede modificarse' });
  }

  console.error('[error]', error);
  return res.status(500).json({
    error: 'Error interno del servidor',
    detalles: env.esProduccion ? undefined : (error as Error)?.message,
  });
}
