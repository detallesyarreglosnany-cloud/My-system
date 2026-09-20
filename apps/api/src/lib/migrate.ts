import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, esperarBaseDeDatos } from './db.js';

const aqui = dirname(fileURLToPath(import.meta.url));
// src/lib -> ../../migrations  |  dist/lib -> ../../migrations
const carpetaMigraciones = join(aqui, '..', '..', 'migrations');

export async function migrar(): Promise<string[]> {
  await esperarBaseDeDatos();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS esquema_migracion (
      nombre     TEXT PRIMARY KEY,
      aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const archivos = (await readdir(carpetaMigraciones))
    .filter((n) => n.endsWith('.sql'))
    .sort();

  const { rows } = await pool.query<{ nombre: string }>('SELECT nombre FROM esquema_migracion');
  const aplicadas = new Set(rows.map((r) => r.nombre));
  const nuevas: string[] = [];

  for (const archivo of archivos) {
    if (aplicadas.has(archivo)) continue;
    const sql = await readFile(join(carpetaMigraciones, archivo), 'utf8');
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query(sql);
      await cliente.query('INSERT INTO esquema_migracion (nombre) VALUES ($1)', [archivo]);
      await cliente.query('COMMIT');
      nuevas.push(archivo);
      console.log(`[migrate] aplicada ${archivo}`);
    } catch (error) {
      await cliente.query('ROLLBACK');
      console.error(`[migrate] fallo en ${archivo}`);
      throw error;
    } finally {
      cliente.release();
    }
  }

  if (nuevas.length === 0) console.log('[migrate] base de datos al dia');
  return nuevas;
}

const ejecutadoDirectamente =
  process.argv[1] && (process.argv[1].endsWith('migrate.ts') || process.argv[1].endsWith('migrate.js'));

if (ejecutadoDirectamente) {
  migrar()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
