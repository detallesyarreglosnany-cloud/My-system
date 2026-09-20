import { consultar, uno } from '../lib/db.js';
import { usd, usdABolivares } from '../lib/dinero.js';
import { tasaVigente } from './tasa.js';

/** Panel principal: todo lo que el dueño quiere ver al abrir el sistema. */
export async function resumen() {
  const tasa = await tasaVigente();

  const hoy = await uno<{ n: number; total: number; costo: number }>(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(total_usd),0) AS total, COALESCE(SUM(costo_usd),0) AS costo
       FROM venta WHERE estado = 'EMITIDA' AND fecha >= date_trunc('day', now())`,
  );
  const mes = await uno<{ n: number; total: number; costo: number; base: number; iva: number }>(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(total_usd),0) AS total, COALESCE(SUM(costo_usd),0) AS costo,
            COALESCE(SUM(base_imponible_usd),0) AS base, COALESCE(SUM(iva_usd),0) AS iva
       FROM venta WHERE estado = 'EMITIDA' AND fecha >= date_trunc('month', now())`,
  );
  const comprasMes = await uno<{ total: number }>(
    `SELECT COALESCE(SUM(total_usd),0) AS total FROM compra
      WHERE estado = 'EMITIDA' AND fecha >= date_trunc('month', now())`,
  );
  const cobrar = await uno<{ total: number; vencido: number; documentos: number }>(
    `SELECT COALESCE(SUM(saldo_usd),0) AS total,
            COALESCE(SUM(CASE WHEN vence_el IS NOT NULL AND vence_el < current_date THEN saldo_usd ELSE 0 END),0) AS vencido,
            COUNT(*)::int AS documentos
       FROM venta WHERE estado = 'EMITIDA' AND saldo_usd > 0.005`,
  );
  const pagar = await uno<{ total: number; vencido: number; documentos: number }>(
    `SELECT COALESCE(SUM(saldo_usd),0) AS total,
            COALESCE(SUM(CASE WHEN vence_el IS NOT NULL AND vence_el < current_date THEN saldo_usd ELSE 0 END),0) AS vencido,
            COUNT(*)::int AS documentos
       FROM compra WHERE estado = 'EMITIDA' AND saldo_usd > 0.005`,
  );
  const inventario = await uno<{ valor: number; unidades: number; referencias: number }>(
    `SELECT COALESCE(SUM(e.cantidad * p.costo_usd),0) AS valor,
            COALESCE(SUM(e.cantidad),0) AS unidades,
            COUNT(DISTINCT p.id)::int AS referencias
       FROM existencia e JOIN producto p ON p.id = e.producto_id
      WHERE p.activo AND p.tipo = 'BIEN'`,
  );
  const bajos = await uno<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM (
        SELECT p.id FROM producto p
          LEFT JOIN existencia e ON e.producto_id = p.id
         WHERE p.activo AND p.tipo = 'BIEN' AND p.stock_minimo > 0
         GROUP BY p.id, p.stock_minimo
        HAVING COALESCE(SUM(e.cantidad),0) <= p.stock_minimo
     ) t`,
  );
  const clientes = await uno<{ n: number }>(`SELECT COUNT(*)::int AS n FROM cliente WHERE activo`);

  const ventaMes = usd(Number(mes?.total ?? 0));
  const costoMes = usd(Number(mes?.costo ?? 0));
  const ventaHoy = usd(Number(hoy?.total ?? 0));

  return {
    tasa,
    hoy: {
      facturas: hoy?.n ?? 0,
      ventas_usd: ventaHoy,
      ventas_bs: usdABolivares(ventaHoy, tasa.valor),
      utilidad_usd: usd(ventaHoy - Number(hoy?.costo ?? 0)),
      ticket_promedio_usd: hoy?.n ? usd(ventaHoy / hoy.n) : 0,
    },
    mes: {
      facturas: mes?.n ?? 0,
      ventas_usd: ventaMes,
      ventas_bs: usdABolivares(ventaMes, tasa.valor),
      costo_usd: costoMes,
      utilidad_usd: usd(ventaMes - costoMes),
      margen_pct: ventaMes > 0 ? usd(((ventaMes - costoMes) / ventaMes) * 100) : 0,
      base_imponible_usd: usd(Number(mes?.base ?? 0)),
      iva_usd: usd(Number(mes?.iva ?? 0)),
      compras_usd: usd(Number(comprasMes?.total ?? 0)),
    },
    cuentas_por_cobrar: {
      total_usd: usd(Number(cobrar?.total ?? 0)),
      vencido_usd: usd(Number(cobrar?.vencido ?? 0)),
      documentos: cobrar?.documentos ?? 0,
    },
    cuentas_por_pagar: {
      total_usd: usd(Number(pagar?.total ?? 0)),
      vencido_usd: usd(Number(pagar?.vencido ?? 0)),
      documentos: pagar?.documentos ?? 0,
    },
    inventario: {
      valor_usd: usd(Number(inventario?.valor ?? 0)),
      unidades: Number(inventario?.unidades ?? 0),
      referencias: inventario?.referencias ?? 0,
      alertas_stock_bajo: bajos?.n ?? 0,
    },
    clientes_activos: clientes?.n ?? 0,
  };
}

export async function ventasPorDia(dias = 30) {
  return consultar(
    `WITH serie AS (
        SELECT generate_series(date_trunc('day', now()) - ($1::int - 1) * interval '1 day',
                               date_trunc('day', now()), interval '1 day')::date AS dia
     )
     SELECT s.dia,
            COALESCE(SUM(v.total_usd), 0) AS ventas_usd,
            COALESCE(SUM(v.total_usd - v.costo_usd), 0) AS utilidad_usd,
            COUNT(v.id)::int AS facturas
       FROM serie s
       LEFT JOIN venta v ON v.fecha::date = s.dia AND v.estado = 'EMITIDA'
      GROUP BY s.dia ORDER BY s.dia`,
    [dias],
  );
}

export async function topProductos(limite = 10, desde?: string, hasta?: string) {
  return consultar(
    `SELECT p.id, p.sku, p.nombre,
            SUM(vl.cantidad) AS unidades,
            SUM(vl.total_usd) AS ingreso_usd,
            SUM(vl.total_usd - vl.cantidad * vl.costo_unitario_usd) AS utilidad_usd
       FROM venta_linea vl
       JOIN venta v ON v.id = vl.venta_id AND v.estado = 'EMITIDA'
       JOIN producto p ON p.id = vl.producto_id
      WHERE ($2::date IS NULL OR v.fecha >= $2::date)
        AND ($3::date IS NULL OR v.fecha < $3::date + interval '1 day')
      GROUP BY p.id, p.sku, p.nombre
      ORDER BY ingreso_usd DESC
      LIMIT $1`,
    [limite, desde ?? null, hasta ?? null],
  );
}

export async function ventasPorMetodo(desde?: string, hasta?: string) {
  return consultar(
    `SELECT mp.codigo, mp.nombre, mp.moneda,
            COUNT(*)::int AS operaciones,
            SUM(pg.monto_usd) AS monto_usd,
            SUM(pg.monto_bs) AS monto_bs,
            SUM(pg.igtf_usd) AS igtf_usd
       FROM pago pg
       JOIN metodo_pago mp ON mp.codigo = pg.metodo
       JOIN venta v ON v.id = pg.venta_id AND v.estado = 'EMITIDA'
      WHERE pg.tipo = 'COBRO'
        AND ($1::date IS NULL OR pg.fecha >= $1::date)
        AND ($2::date IS NULL OR pg.fecha < $2::date + interval '1 day')
      GROUP BY mp.codigo, mp.nombre, mp.moneda
      ORDER BY monto_usd DESC`,
    [desde ?? null, hasta ?? null],
  );
}

/**
 * Libro de ventas: una fila por factura con los montos en bolivares a la tasa
 * del dia de emision, que es el formato que pide el SENIAT.
 */
export async function libroDeVentas(desde: string, hasta: string) {
  const filas = await consultar<any>(
    `SELECT v.fecha::date AS fecha, v.numero, v.estado, v.tasa,
            COALESCE(c.tipo_documento || '-' || c.documento, 'CONTADO') AS documento_cliente,
            COALESCE(c.nombre, 'Consumidor final') AS cliente,
            v.base_imponible_usd, v.iva_usd, v.igtf_usd, v.total_usd
       FROM venta v LEFT JOIN cliente c ON c.id = v.cliente_id
      WHERE v.fecha >= $1::date AND v.fecha < $2::date + interval '1 day'
      ORDER BY v.fecha, v.id`,
    [desde, hasta],
  );

  const detalle = filas.map((f) => ({
    ...f,
    anulada: f.estado === 'ANULADA',
    base_imponible_bs: usdABolivares(Number(f.base_imponible_usd), Number(f.tasa)),
    iva_bs: usdABolivares(Number(f.iva_usd), Number(f.tasa)),
    igtf_bs: usdABolivares(Number(f.igtf_usd), Number(f.tasa)),
    total_bs: usdABolivares(Number(f.total_usd), Number(f.tasa)),
  }));

  const vigentes = detalle.filter((f) => !f.anulada);
  const sumar = (clave: string) => usd(vigentes.reduce((a, f: any) => a + Number(f[clave]), 0));

  return {
    desde,
    hasta,
    detalle,
    totales: {
      documentos: vigentes.length,
      anulados: detalle.length - vigentes.length,
      base_imponible_usd: sumar('base_imponible_usd'),
      iva_usd: sumar('iva_usd'),
      igtf_usd: sumar('igtf_usd'),
      total_usd: sumar('total_usd'),
      base_imponible_bs: sumar('base_imponible_bs'),
      iva_bs: sumar('iva_bs'),
      igtf_bs: sumar('igtf_bs'),
      total_bs: sumar('total_bs'),
    },
  };
}

/** Antiguedad de saldos de clientes o proveedores. */
export async function antiguedadSaldos(tipo: 'COBRAR' | 'PAGAR') {
  const esCobrar = tipo === 'COBRAR';
  const tabla = esCobrar ? 'venta' : 'compra';
  const relacion = esCobrar ? 'cliente' : 'proveedor';
  const llave = esCobrar ? 'cliente_id' : 'proveedor_id';

  return consultar(
    `SELECT COALESCE(r.nombre, 'Sin ${relacion}') AS nombre, r.id AS ${relacion}_id,
            COUNT(*)::int AS documentos,
            SUM(d.saldo_usd) AS saldo_usd,
            SUM(CASE WHEN d.vence_el IS NULL OR d.vence_el >= current_date THEN d.saldo_usd ELSE 0 END) AS por_vencer_usd,
            SUM(CASE WHEN d.vence_el < current_date AND d.vence_el >= current_date - 30 THEN d.saldo_usd ELSE 0 END) AS vencido_1_30_usd,
            SUM(CASE WHEN d.vence_el < current_date - 30 AND d.vence_el >= current_date - 60 THEN d.saldo_usd ELSE 0 END) AS vencido_31_60_usd,
            SUM(CASE WHEN d.vence_el < current_date - 60 THEN d.saldo_usd ELSE 0 END) AS vencido_60_mas_usd
       FROM ${tabla} d
       LEFT JOIN ${relacion} r ON r.id = d.${llave}
      WHERE d.estado = 'EMITIDA' AND d.saldo_usd > 0.005
      GROUP BY r.id, r.nombre
      ORDER BY saldo_usd DESC`,
  );
}

export async function valorizacionInventario(sucursalId?: number) {
  return consultar(
    `SELECT p.id, p.sku, p.nombre, cat.nombre AS categoria, p.costo_usd, p.precio_usd, p.stock_minimo,
            COALESCE(SUM(e.cantidad), 0) AS existencia,
            COALESCE(SUM(e.cantidad), 0) * p.costo_usd AS valor_costo_usd,
            COALESCE(SUM(e.cantidad), 0) * p.precio_usd AS valor_venta_usd
       FROM producto p
       LEFT JOIN categoria cat ON cat.id = p.categoria_id
       LEFT JOIN existencia e ON e.producto_id = p.id AND ($1::int IS NULL OR e.sucursal_id = $1::int)
      WHERE p.activo AND p.tipo = 'BIEN'
      GROUP BY p.id, p.sku, p.nombre, cat.nombre, p.costo_usd, p.precio_usd, p.stock_minimo
      ORDER BY valor_costo_usd DESC`,
    [sucursalId ?? null],
  );
}
