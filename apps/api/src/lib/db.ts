import pg from 'pg';
import { env } from './env.js';

// NUMERIC llega como string desde pg para no perder precision. En esta app los
// montos caben de sobra en un double, asi que los convertimos a number en el
// borde y trabajamos con enteros de centavos donde importa (ver dinero.ts).
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v: string) => Number(v));
pg.types.setTypeParser(pg.types.builtins.INT8, (v: string) => Number(v));

function configuracionTls(): pg.PoolConfig['ssl'] {
  if (env.databaseSsl === 'require') return { rejectUnauthorized: true };
  if (env.databaseSsl === 'no-verify') return { rejectUnauthorized: false };
  return undefined;
}

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  ssl: configuracionTls(),
  // En serverless conviene un pool pequeño: hay muchas instancias efimeras.
  max: env.poolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
});

pool.on('error', (err) => {
  console.error('[db] error en cliente inactivo:', err.message);
});

export type Consultable = pg.Pool | pg.PoolClient;

export async function consultar<T extends pg.QueryResultRow = any>(
  sql: string,
  params: unknown[] = [],
  cliente: Consultable = pool,
): Promise<T[]> {
  const res = await cliente.query<T>(sql, params as any[]);
  return res.rows;
}

export async function uno<T extends pg.QueryResultRow = any>(
  sql: string,
  params: unknown[] = [],
  cliente: Consultable = pool,
): Promise<T | null> {
  const filas = await consultar<T>(sql, params, cliente);
  return filas[0] ?? null;
}

/** Ejecuta `fn` dentro de una transaccion, con rollback automatico ante error. */
export async function enTransaccion<T>(fn: (cliente: pg.PoolClient) => Promise<T>): Promise<T> {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    try { await cliente.query('ROLLBACK'); } catch { /* la conexion ya murio */ }
    throw error;
  } finally {
    cliente.release();
  }
}

export async function esperarBaseDeDatos(intentos = 30, esperaMs = 1000): Promise<void> {
  for (let i = 1; i <= intentos; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      if (i === intentos) throw error;
      console.log(`[db] esperando a PostgreSQL (${i}/${intentos})…`);
      await new Promise((r) => setTimeout(r, esperaMs));
    }
  }
}
