import { crearApp } from './app.js';
import { env } from './lib/env.js';
import { pool, esperarBaseDeDatos } from './lib/db.js';
import { migrar } from './lib/migrate.js';
import { programarSincronizacionDiaria } from './modules/tasa.js';

async function arrancar() {
  await esperarBaseDeDatos();
  // Migrar al arrancar mantiene el despliegue en un solo paso: `docker compose up`.
  await migrar();

  const app = crearApp();
  const servidor = app.listen(env.puerto, () => {
    console.log(`[api] escuchando en http://0.0.0.0:${env.puerto} (${env.nodeEnv})`);
  });

  const temporizador = programarSincronizacionDiaria();

  const apagar = (senal: string) => async () => {
    console.log(`[api] ${senal} recibido, cerrando…`);
    if (temporizador) clearInterval(temporizador);
    servidor.close(async () => {
      await pool.end();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', apagar('SIGTERM'));
  process.on('SIGINT', apagar('SIGINT'));
}

arrancar().catch((error) => {
  console.error('[api] no se pudo arrancar:', error);
  process.exit(1);
});
