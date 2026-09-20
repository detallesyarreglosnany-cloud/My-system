import type pg from 'pg';
import { consultar, enTransaccion, uno } from '../lib/db.js';
import { usd, usdABolivares, porcentaje, cantidad as redCantidad } from '../lib/dinero.js';
import { conflicto, noEncontrado, solicitudInvalida } from '../lib/errores.js';
import type { Sesion } from '../lib/auth.js';
import { aplicarMovimiento, recalcularCostoPromedio } from './inventario.js';
import { tasaVigente } from './tasa.js';
import { siguienteCorrelativo } from './correlativos.js';
import { calcularPagos, registrarAuditoria, type PagoEntrada } from './ventas.js';

const EPSILON = 0.005;

export interface LineaCompraEntrada {
  productoId: number;
  cantidad: number;
  costoUsd: number;
  ivaTasa?: number;
}

export interface CompraEntrada {
  proveedorId?: number | null;
  sucursalId?: number;
  documentoProveedor?: string;
  condicion?: 'CONTADO' | 'CREDITO';
  diasCredito?: number;
  nota?: string;
  lineas: LineaCompraEntrada[];
  pagos?: PagoEntrada[];
}

/**
 * Registra una compra: suma existencia en la sucursal indicada y actualiza el
 * costo promedio ponderado de cada producto, que es lo que alimenta el margen
 * mostrado en los reportes.
 */
export async function crearCompra(entrada: CompraEntrada, sesion: Sesion) {
  if (!entrada.lineas?.length) throw solicitudInvalida('La compra debe tener al menos una linea');

  return enTransaccion(async (cliente) => {
    const sucursalId = await resolverSucursal(cliente, entrada.sucursalId ?? sesion.sucursalId);
    const tasa = (await tasaVigente(undefined, cliente)).valor;
    const condicion = entrada.condicion ?? 'CONTADO';

    if (condicion === 'CREDITO' && !entrada.proveedorId) {
      throw solicitudInvalida('Una compra a credito requiere un proveedor identificado');
    }

    const lineas: Array<LineaCompraEntrada & { descripcion: string; ivaUsd: number; totalUsd: number; esBien: boolean }> = [];

    for (const [indice, l] of entrada.lineas.entries()) {
      const cant = redCantidad(l.cantidad);
      if (!(cant > 0)) throw solicitudInvalida(`Linea ${indice + 1}: la cantidad debe ser mayor que cero`);
      const producto = await uno<{ id: number; nombre: string; iva_tasa: number; tipo: string; activo: boolean }>(
        'SELECT id, nombre, iva_tasa, tipo, activo FROM producto WHERE id = $1',
        [l.productoId],
        cliente,
      );
      if (!producto) throw noEncontrado(`Linea ${indice + 1}: el producto ${l.productoId} no existe`);
      if (!producto.activo) throw solicitudInvalida(`Linea ${indice + 1}: "${producto.nombre}" esta inactivo`);

      const costo = usd(l.costoUsd);
      if (!(costo >= 0)) throw solicitudInvalida(`Linea ${indice + 1}: costo invalido`);
      const neto = usd(cant * costo);
      const ivaTasa = l.ivaTasa ?? Number(producto.iva_tasa);
      const ivaUsd = porcentaje(neto, ivaTasa);

      lineas.push({
        ...l,
        cantidad: cant,
        costoUsd: costo,
        ivaTasa,
        descripcion: producto.nombre,
        ivaUsd,
        totalUsd: usd(neto + ivaUsd),
        esBien: producto.tipo === 'BIEN',
      });
    }

    const subtotal = usd(lineas.reduce((a, l) => a + l.cantidad * l.costoUsd, 0));
    const ivaTotal = usd(lineas.reduce((a, l) => a + l.ivaUsd, 0));
    const total = usd(subtotal + ivaTotal);

    const pagos = await calcularPagos(cliente, entrada.pagos ?? [], tasa);
    const pagado = usd(pagos.reduce((a, p) => a + p.montoUsd, 0));
    const saldo = usd(total - pagado);

    if (pagado > total + EPSILON) throw solicitudInvalida('Los pagos superan el total de la compra');
    if (condicion === 'CONTADO' && saldo > EPSILON) {
      throw solicitudInvalida(`Compra de contado sin cubrir: faltan ${saldo.toFixed(2)} USD`);
    }

    const numero = await siguienteCorrelativo(cliente, 'COMPRA');
    const diasCredito = condicion === 'CREDITO' ? Math.max(entrada.diasCredito ?? 0, 0) : 0;

    const compra = await uno<{ id: number }>(
      `INSERT INTO compra
         (numero, documento_proveedor, proveedor_id, sucursal_id, usuario_id, condicion, estado, tasa,
          subtotal_usd, iva_usd, total_usd, pagado_usd, saldo_usd, dias_credito, vence_el, nota)
       VALUES ($1,$2,$3,$4,$5,$6,'EMITIDA',$7,$8,$9,$10,$11,$12,$13,
               CASE WHEN $13 > 0 THEN (now() + ($13 || ' days')::interval)::date ELSE NULL END, $14)
       RETURNING id`,
      [
        numero,
        entrada.documentoProveedor ?? '',
        entrada.proveedorId ?? null,
        sucursalId,
        sesion.id,
        condicion,
        tasa,
        subtotal,
        ivaTotal,
        total,
        pagado,
        saldo,
        diasCredito,
        entrada.nota ?? '',
      ],
      cliente,
    );
    const compraId = compra!.id;

    for (const l of lineas) {
      await cliente.query(
        `INSERT INTO compra_linea (compra_id, producto_id, descripcion, cantidad, costo_usd, iva_tasa, iva_usd, total_usd)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [compraId, l.productoId, l.descripcion, l.cantidad, l.costoUsd, l.ivaTasa, l.ivaUsd, l.totalUsd],
      );

      if (l.esBien) {
        await aplicarMovimiento(cliente, {
          productoId: l.productoId,
          sucursalId,
          delta: l.cantidad,
          tipo: 'ENTRADA',
          costoUnitarioUsd: l.costoUsd,
          referenciaTipo: 'COMPRA',
          referenciaId: compraId,
          nota: `Compra ${numero}`,
          usuarioId: sesion.id,
        });
        await recalcularCostoPromedio(cliente, l.productoId, l.cantidad, l.costoUsd);
      }
    }

    for (const p of pagos) {
      await cliente.query(
        `INSERT INTO pago (tipo, compra_id, metodo, moneda, tasa, monto_usd, monto_bs, igtf_usd, referencia, usuario_id)
         VALUES ('PAGO',$1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [compraId, p.metodo, p.moneda, tasa, p.montoUsd, p.montoBs, p.igtfUsd, p.referencia, sesion.id],
      );
    }

    await registrarAuditoria(cliente, sesion.id, 'COMPRA_CREADA', 'compra', compraId, { numero, total_usd: total });
    return obtenerCompra(compraId, cliente);
  });
}

export async function anularCompra(compraId: number, motivo: string, sesion: Sesion) {
  return enTransaccion(async (cliente) => {
    const compra = await uno<{ id: number; numero: string; estado: string; sucursal_id: number }>(
      'SELECT id, numero, estado, sucursal_id FROM compra WHERE id = $1 FOR UPDATE',
      [compraId],
      cliente,
    );
    if (!compra) throw noEncontrado('La compra no existe');
    if (compra.estado === 'ANULADA') throw conflicto('La compra ya estaba anulada');

    const lineas = await consultar<{ producto_id: number; cantidad: number; costo_usd: number }>(
      `SELECT cl.producto_id, cl.cantidad, cl.costo_usd
         FROM compra_linea cl JOIN producto p ON p.id = cl.producto_id
        WHERE cl.compra_id = $1 AND p.tipo = 'BIEN'`,
      [compraId],
      cliente,
    );

    for (const l of lineas) {
      // Permite saldo negativo: la mercancia pudo haberse vendido ya, y el
      // inventario debe reflejar el faltante en vez de bloquear la anulacion.
      await aplicarMovimiento(cliente, {
        productoId: l.producto_id,
        sucursalId: compra.sucursal_id,
        delta: -Number(l.cantidad),
        tipo: 'SALIDA',
        costoUnitarioUsd: Number(l.costo_usd),
        referenciaTipo: 'COMPRA',
        referenciaId: compraId,
        nota: `Anulacion de ${compra.numero}`,
        usuarioId: sesion.id,
        permitirNegativo: true,
      });
    }

    await cliente.query(
      `UPDATE compra SET estado = 'ANULADA', saldo_usd = 0, anulada_en = now(), anulada_motivo = $2 WHERE id = $1`,
      [compraId, motivo],
    );
    await registrarAuditoria(cliente, sesion.id, 'COMPRA_ANULADA', 'compra', compraId, { numero: compra.numero, motivo });
    return obtenerCompra(compraId, cliente);
  });
}

export async function abonarCompra(compraId: number, pago: PagoEntrada, sesion: Sesion) {
  return enTransaccion(async (cliente) => {
    const compra = await uno<{ id: number; numero: string; estado: string; saldo_usd: number }>(
      'SELECT id, numero, estado, saldo_usd FROM compra WHERE id = $1 FOR UPDATE',
      [compraId],
      cliente,
    );
    if (!compra) throw noEncontrado('La compra no existe');
    if (compra.estado === 'ANULADA') throw conflicto('No se puede abonar una compra anulada');

    const saldo = usd(Number(compra.saldo_usd));
    if (saldo <= EPSILON) throw conflicto('La compra ya esta totalmente pagada');

    const tasa = (await tasaVigente(undefined, cliente)).valor;
    const [calculado] = await calcularPagos(cliente, [pago], tasa);
    if (calculado.montoUsd > saldo + EPSILON) {
      throw solicitudInvalida(`El pago supera el saldo pendiente (${saldo.toFixed(2)} USD)`);
    }

    await cliente.query(
      `INSERT INTO pago (tipo, compra_id, metodo, moneda, tasa, monto_usd, monto_bs, igtf_usd, referencia, usuario_id)
       VALUES ('PAGO',$1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [compraId, calculado.metodo, calculado.moneda, tasa, calculado.montoUsd, calculado.montoBs, calculado.igtfUsd, calculado.referencia, sesion.id],
    );
    await cliente.query(
      `UPDATE compra
          SET pagado_usd = t.pagado,
              saldo_usd  = GREATEST(total_usd - t.pagado, 0)
         FROM (SELECT COALESCE(SUM(monto_usd),0) AS pagado FROM pago WHERE compra_id = $1) t
        WHERE compra.id = $1`,
      [compraId],
    );
    await registrarAuditoria(cliente, sesion.id, 'COMPRA_ABONADA', 'compra', compraId, {
      numero: compra.numero,
      monto_usd: calculado.montoUsd,
    });
    return obtenerCompra(compraId, cliente);
  });
}

async function resolverSucursal(cliente: pg.PoolClient, sugerida?: number | null): Promise<number> {
  if (sugerida) {
    const s = await uno<{ id: number }>('SELECT id FROM sucursal WHERE id = $1 AND activa', [sugerida], cliente);
    if (!s) throw noEncontrado(`La sucursal ${sugerida} no existe o esta inactiva`);
    return s.id;
  }
  const principal = await uno<{ id: number }>(
    'SELECT id FROM sucursal WHERE activa ORDER BY es_principal DESC, id ASC LIMIT 1',
    [],
    cliente,
  );
  if (!principal) throw conflicto('No hay ninguna sucursal activa configurada');
  return principal.id;
}

export async function obtenerCompra(compraId: number, cliente?: pg.PoolClient) {
  const ejecutor = cliente as any;
  const compra = await uno(
    `SELECT c.*, p.nombre AS proveedor_nombre, s.nombre AS sucursal_nombre, u.nombre AS usuario_nombre
       FROM compra c
       LEFT JOIN proveedor p ON p.id = c.proveedor_id
       LEFT JOIN sucursal s ON s.id = c.sucursal_id
       LEFT JOIN usuario u ON u.id = c.usuario_id
      WHERE c.id = $1`,
    [compraId],
    ejecutor,
  );
  if (!compra) throw noEncontrado('La compra no existe');

  const lineas = await consultar(
    `SELECT cl.*, p.sku FROM compra_linea cl LEFT JOIN producto p ON p.id = cl.producto_id
      WHERE cl.compra_id = $1 ORDER BY cl.id`,
    [compraId],
    ejecutor,
  );
  const pagos = await consultar(
    `SELECT pg.*, mp.nombre AS metodo_nombre FROM pago pg JOIN metodo_pago mp ON mp.codigo = pg.metodo
      WHERE pg.compra_id = $1 ORDER BY pg.id`,
    [compraId],
    ejecutor,
  );

  const tasa = Number((compra as any).tasa);
  return { ...compra, lineas, pagos, total_bs: usdABolivares(Number((compra as any).total_usd), tasa) };
}

export async function listarCompras(f: {
  desde?: string; hasta?: string; proveedorId?: number; estado?: string;
  soloPendientes?: boolean; pagina: number; porPagina: number;
}) {
  const condiciones = ['1=1'];
  const params: unknown[] = [];
  const add = (sql: string, valor: unknown) => {
    params.push(valor);
    condiciones.push(sql.replace('?', `$${params.length}`));
  };
  if (f.desde) add('c.fecha >= ?::date', f.desde);
  if (f.hasta) add("c.fecha < (?::date + interval '1 day')", f.hasta);
  if (f.proveedorId) add('c.proveedor_id = ?', f.proveedorId);
  if (f.estado) add('c.estado = ?', f.estado);
  if (f.soloPendientes) condiciones.push("c.estado = 'EMITIDA' AND c.saldo_usd > 0.005");

  const donde = condiciones.join(' AND ');
  const desplazamiento = (f.pagina - 1) * f.porPagina;

  const datos = await consultar(
    `SELECT c.id, c.numero, c.documento_proveedor, c.fecha, c.condicion, c.estado,
            c.total_usd, c.saldo_usd, c.vence_el, p.nombre AS proveedor_nombre, s.nombre AS sucursal_nombre
       FROM compra c
       LEFT JOIN proveedor p ON p.id = c.proveedor_id
       LEFT JOIN sucursal s ON s.id = c.sucursal_id
      WHERE ${donde}
      ORDER BY c.fecha DESC, c.id DESC
      LIMIT ${f.porPagina} OFFSET ${desplazamiento}`,
    params,
  );
  const total = await uno<{ n: number }>(`SELECT COUNT(*)::int AS n FROM compra c WHERE ${donde}`, params);
  return { datos, total: total?.n ?? 0, pagina: f.pagina, porPagina: f.porPagina };
}
