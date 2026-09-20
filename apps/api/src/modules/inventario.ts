import type pg from 'pg';
import { consultar, uno } from '../lib/db.js';
import { cantidad as redCantidad, usd } from '../lib/dinero.js';
import { conflicto, noEncontrado, solicitudInvalida } from '../lib/errores.js';

export type TipoMovimiento = 'ENTRADA' | 'SALIDA' | 'AJUSTE' | 'TRANSFERENCIA';

export interface MovimientoSolicitado {
  productoId: number;
  sucursalId: number;
  /** Con signo: positivo entra al almacen, negativo sale. */
  delta: number;
  tipo: TipoMovimiento;
  costoUnitarioUsd?: number;
  referenciaTipo?: string | null;
  referenciaId?: number | null;
  nota?: string;
  usuarioId?: number | null;
  /** Permite dejar la existencia en negativo (usado al anular documentos). */
  permitirNegativo?: boolean;
}

/**
 * Aplica un movimiento de inventario dentro de una transaccion.
 *
 * Toma un lock de fila sobre `existencia` (SELECT … FOR UPDATE) antes de
 * calcular el saldo, de modo que dos ventas simultaneas del mismo producto no
 * puedan sobrevender. Devuelve el saldo resultante.
 */
export async function aplicarMovimiento(
  cliente: pg.PoolClient,
  mov: MovimientoSolicitado,
): Promise<number> {
  const delta = redCantidad(mov.delta);
  if (delta === 0) {
    const actual = await existenciaActual(cliente, mov.productoId, mov.sucursalId);
    return actual;
  }

  const producto = await uno<{ id: number; tipo: string; nombre: string }>(
    'SELECT id, tipo, nombre FROM producto WHERE id = $1',
    [mov.productoId],
    cliente,
  );
  if (!producto) throw noEncontrado(`Producto ${mov.productoId} no existe`);
  // Los servicios no manejan existencia: se registran en la venta pero no mueven stock.
  if (producto.tipo === 'SERVICIO') return 0;

  // Crea la fila si no existe y la bloquea.
  await cliente.query(
    `INSERT INTO existencia (producto_id, sucursal_id, cantidad) VALUES ($1, $2, 0)
       ON CONFLICT (producto_id, sucursal_id) DO NOTHING`,
    [mov.productoId, mov.sucursalId],
  );
  const bloqueada = await uno<{ cantidad: number }>(
    'SELECT cantidad FROM existencia WHERE producto_id = $1 AND sucursal_id = $2 FOR UPDATE',
    [mov.productoId, mov.sucursalId],
    cliente,
  );

  const saldoAnterior = Number(bloqueada?.cantidad ?? 0);
  const saldoNuevo = redCantidad(saldoAnterior + delta);

  if (saldoNuevo < 0 && !mov.permitirNegativo) {
    throw conflicto(
      `Stock insuficiente de "${producto.nombre}": disponible ${saldoAnterior}, se requieren ${Math.abs(delta)}`,
      { productoId: producto.id, disponible: saldoAnterior, solicitado: Math.abs(delta) },
    );
  }

  await cliente.query(
    'UPDATE existencia SET cantidad = $3 WHERE producto_id = $1 AND sucursal_id = $2',
    [mov.productoId, mov.sucursalId, saldoNuevo],
  );

  await cliente.query(
    `INSERT INTO movimiento_inventario
       (producto_id, sucursal_id, tipo, cantidad, saldo_resultante, costo_unitario_usd,
        referencia_tipo, referencia_id, nota, usuario_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      mov.productoId,
      mov.sucursalId,
      mov.tipo,
      delta,
      saldoNuevo,
      usd(mov.costoUnitarioUsd ?? 0),
      mov.referenciaTipo ?? null,
      mov.referenciaId ?? null,
      mov.nota ?? '',
      mov.usuarioId ?? null,
    ],
  );

  return saldoNuevo;
}

export async function existenciaActual(
  cliente: pg.PoolClient,
  productoId: number,
  sucursalId: number,
): Promise<number> {
  const fila = await uno<{ cantidad: number }>(
    'SELECT cantidad FROM existencia WHERE producto_id = $1 AND sucursal_id = $2',
    [productoId, sucursalId],
    cliente,
  );
  return Number(fila?.cantidad ?? 0);
}

/**
 * Costo promedio ponderado tras una entrada. Se recalcula sobre el stock total
 * de la empresa (todas las sucursales), que es como razona un dueño de PyME.
 */
export async function recalcularCostoPromedio(
  cliente: pg.PoolClient,
  productoId: number,
  cantidadEntrante: number,
  costoEntrante: number,
): Promise<number> {
  const fila = await uno<{ costo_usd: number; stock: number }>(
    `SELECT p.costo_usd, COALESCE((SELECT SUM(cantidad) FROM existencia WHERE producto_id = p.id), 0) AS stock
       FROM producto p WHERE p.id = $1`,
    [productoId],
    cliente,
  );
  if (!fila) throw noEncontrado(`Producto ${productoId} no existe`);

  const stockPrevio = Math.max(Number(fila.stock) - cantidadEntrante, 0);
  const costoPrevio = Number(fila.costo_usd);
  const total = stockPrevio + cantidadEntrante;
  const nuevoCosto =
    total <= 0 ? usd(costoEntrante) : usd((stockPrevio * costoPrevio + cantidadEntrante * costoEntrante) / total);

  await cliente.query('UPDATE producto SET costo_usd = $2, actualizado_en = now() WHERE id = $1', [
    productoId,
    nuevoCosto,
  ]);
  return nuevoCosto;
}

export async function transferir(
  cliente: pg.PoolClient,
  opciones: {
    productoId: number;
    origenId: number;
    destinoId: number;
    cantidad: number;
    usuarioId?: number | null;
    nota?: string;
  },
): Promise<{ origen: number; destino: number }> {
  const cant = redCantidad(opciones.cantidad);
  if (cant <= 0) throw solicitudInvalida('La cantidad a transferir debe ser mayor que cero');
  if (opciones.origenId === opciones.destinoId) {
    throw solicitudInvalida('El almacen de origen y el de destino deben ser distintos');
  }
  const nota = opciones.nota ?? `Transferencia ${opciones.origenId} -> ${opciones.destinoId}`;
  const origen = await aplicarMovimiento(cliente, {
    productoId: opciones.productoId,
    sucursalId: opciones.origenId,
    delta: -cant,
    tipo: 'TRANSFERENCIA',
    referenciaTipo: 'TRANSFERENCIA',
    nota,
    usuarioId: opciones.usuarioId,
  });
  const destino = await aplicarMovimiento(cliente, {
    productoId: opciones.productoId,
    sucursalId: opciones.destinoId,
    delta: cant,
    tipo: 'TRANSFERENCIA',
    referenciaTipo: 'TRANSFERENCIA',
    nota,
    usuarioId: opciones.usuarioId,
  });
  return { origen, destino };
}

export interface FilaStockBajo {
  producto_id: number;
  sku: string;
  nombre: string;
  existencia: number;
  stock_minimo: number;
  /** Donde esta repartido lo que queda, para saber a que almacen ir. */
  detalle: string;
}

/**
 * Productos cuya existencia TOTAL (sumando almacenes activos) esta en o por
 * debajo del minimo. Se mide sobre el total y no por almacen para que el
 * conteo coincida con el del panel y no se dispare una alerta por cada
 * deposito vacio.
 */
export async function stockBajo(limite = 50, sucursalId?: number): Promise<FilaStockBajo[]> {
  return consultar<FilaStockBajo>(
    `SELECT p.id AS producto_id, p.sku, p.nombre, p.stock_minimo,
            COALESCE(SUM(e.cantidad), 0) AS existencia,
            COALESCE(
              string_agg(s.nombre || ': ' || trim(to_char(e.cantidad, 'FM999999990.####')), ', '
                         ORDER BY e.cantidad DESC) FILTER (WHERE e.cantidad > 0),
              'sin existencia'
            ) AS detalle
       FROM producto p
       LEFT JOIN existencia e ON e.producto_id = p.id
       LEFT JOIN sucursal s ON s.id = e.sucursal_id AND s.activa
      WHERE p.activo AND p.tipo = 'BIEN' AND p.stock_minimo > 0
        AND ($2::int IS NULL OR e.sucursal_id = $2::int)
      GROUP BY p.id, p.sku, p.nombre, p.stock_minimo
     HAVING COALESCE(SUM(e.cantidad), 0) <= p.stock_minimo
      ORDER BY (COALESCE(SUM(e.cantidad), 0) - p.stock_minimo) ASC, p.nombre
      LIMIT $1`,
    [limite, sucursalId ?? null],
  );
}
