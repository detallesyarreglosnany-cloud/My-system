import type pg from 'pg';
import { uno } from '../lib/db.js';
import { conflicto } from '../lib/errores.js';

/**
 * Reserva el siguiente numero de documento. El UPDATE … RETURNING bloquea la
 * fila hasta el COMMIT, asi que dos cajas facturando a la vez nunca obtienen
 * el mismo correlativo.
 */
export async function siguienteCorrelativo(cliente: pg.PoolClient, tipo: 'VENTA' | 'COMPRA'): Promise<string> {
  const fila = await uno<{ prefijo: string; numero: number }>(
    `UPDATE correlativo SET siguiente = siguiente + 1
      WHERE tipo = $1
      RETURNING prefijo, siguiente - 1 AS numero`,
    [tipo],
    cliente,
  );
  if (!fila) throw conflicto(`No hay correlativo configurado para ${tipo}`);
  return `${fila.prefijo}${String(fila.numero).padStart(6, '0')}`;
}
