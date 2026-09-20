import type pg from 'pg';
import { consultar, enTransaccion, pool, uno, type Consultable } from '../lib/db.js';
import { usd, usdABolivares, porcentaje, cantidad as redCantidad } from '../lib/dinero.js';
import { conflicto, noEncontrado, solicitudInvalida } from '../lib/errores.js';
import type { Sesion } from '../lib/auth.js';
import { aplicarMovimiento } from './inventario.js';
import { tasaVigente } from './tasa.js';
import { siguienteCorrelativo } from './correlativos.js';

/** Tolerancia de cuadre: medio centavo. */
const EPSILON = 0.005;

export interface LineaEntrada {
  productoId?: number | null;
  descripcion?: string;
  cantidad: number;
  /** Si se omite, se toma el precio de lista del producto. */
  precioUsd?: number;
  /** Descuento en USD sobre el total de la linea. */
  descuentoUsd?: number;
  /** Si se omite, se toma la alicuota del producto. */
  ivaTasa?: number;
}

export interface PagoEntrada {
  metodo: string;
  /** Monto aplicado a la factura, expresado en USD. */
  montoUsd: number;
  referencia?: string;
}

export interface VentaEntrada {
  sucursalId?: number;
  clienteId?: number | null;
  condicion?: 'CONTADO' | 'CREDITO';
  diasCredito?: number;
  nota?: string;
  /** Descuento global adicional en USD. */
  descuentoUsd?: number;
  lineas: LineaEntrada[];
  pagos?: PagoEntrada[];
}

interface LineaCalculada {
  productoId: number | null;
  descripcion: string;
  cantidad: number;
  precioUsd: number;
  descuentoUsd: number;
  ivaTasa: number;
  ivaUsd: number;
  totalUsd: number;
  costoUnitarioUsd: number;
  esBien: boolean;
}

/**
 * Registra una venta completa: valida stock, calcula IVA por linea, aplica los
 * pagos con su IGTF, descuenta inventario y deja la cuenta por cobrar cuadrada.
 * Todo ocurre en una sola transaccion: si algo falla, no queda nada a medias.
 */
export async function crearVenta(entrada: VentaEntrada, sesion: Sesion) {
  if (!entrada.lineas?.length) throw solicitudInvalida('La venta debe tener al menos una linea');

  return enTransaccion(async (cliente) => {
    const sucursalId = await resolverSucursal(cliente, entrada.sucursalId ?? sesion.sucursalId);
    const tasa = (await tasaVigente(undefined, cliente)).valor;
    const condicion = entrada.condicion ?? 'CONTADO';

    if (condicion === 'CREDITO' && !entrada.clienteId) {
      throw solicitudInvalida('Una venta a credito requiere un cliente identificado');
    }

    const lineas = await calcularLineas(cliente, entrada.lineas);

    const subtotal = usd(lineas.reduce((a, l) => a + l.cantidad * l.precioUsd, 0));
    const descuentoLineas = usd(lineas.reduce((a, l) => a + l.descuentoUsd, 0));
    const descuentoGlobal = usd(Math.max(entrada.descuentoUsd ?? 0, 0));
    const descuentoTotal = usd(descuentoLineas + descuentoGlobal);

    if (descuentoTotal > subtotal + EPSILON) {
      throw solicitudInvalida('El descuento no puede superar el subtotal');
    }

    const baseImponible = usd(subtotal - descuentoTotal);
    // El descuento global se prorratea para no distorsionar el IVA declarado.
    const factorGlobal = subtotal - descuentoLineas > 0 ? 1 - descuentoGlobal / (subtotal - descuentoLineas) : 1;
    const ivaTotal = usd(lineas.reduce((a, l) => a + l.ivaUsd * factorGlobal, 0));
    const montoFactura = usd(baseImponible + ivaTotal);
    const costoTotal = usd(lineas.reduce((a, l) => a + l.cantidad * l.costoUnitarioUsd, 0));

    const pagos = await calcularPagos(cliente, entrada.pagos ?? [], tasa);
    const pagado = usd(pagos.reduce((a, p) => a + p.montoUsd, 0));
    const igtf = usd(pagos.reduce((a, p) => a + p.igtfUsd, 0));
    const saldo = usd(montoFactura - pagado);

    if (pagado > montoFactura + EPSILON) {
      throw solicitudInvalida(
        `Los pagos (${pagado.toFixed(2)} USD) superan el total de la factura (${montoFactura.toFixed(2)} USD)`,
      );
    }
    if (condicion === 'CONTADO' && saldo > EPSILON) {
      throw solicitudInvalida(
        `Venta de contado sin cubrir: faltan ${saldo.toFixed(2)} USD. Registra el pago o cambia la condicion a credito.`,
      );
    }

    if (condicion === 'CREDITO' && entrada.clienteId) {
      await verificarCredito(cliente, entrada.clienteId, saldo);
    }

    const numero = await siguienteCorrelativo(cliente, 'VENTA');
    const diasCredito = condicion === 'CREDITO' ? Math.max(entrada.diasCredito ?? 0, 0) : 0;

    const venta = await uno<{ id: number }>(
      `INSERT INTO venta
         (numero, sucursal_id, cliente_id, usuario_id, condicion, estado, tasa,
          subtotal_usd, descuento_usd, base_imponible_usd, iva_usd, igtf_usd, total_usd,
          costo_usd, pagado_usd, saldo_usd, dias_credito, vence_el, nota)
       VALUES ($1,$2,$3,$4,$5,'EMITIDA',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
               CASE WHEN $16 > 0 THEN (now() + ($16 || ' days')::interval)::date ELSE NULL END, $17)
       RETURNING id`,
      [
        numero,
        sucursalId,
        entrada.clienteId ?? null,
        sesion.id,
        condicion,
        tasa,
        subtotal,
        descuentoTotal,
        baseImponible,
        ivaTotal,
        igtf,
        usd(montoFactura + igtf),
        costoTotal,
        pagado,
        saldo,
        diasCredito,
        entrada.nota ?? '',
      ],
      cliente,
    );
    const ventaId = venta!.id;

    for (const l of lineas) {
      await cliente.query(
        `INSERT INTO venta_linea
           (venta_id, producto_id, descripcion, cantidad, precio_usd, descuento_usd,
            iva_tasa, iva_usd, total_usd, costo_unitario_usd)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          ventaId,
          l.productoId,
          l.descripcion,
          l.cantidad,
          l.precioUsd,
          l.descuentoUsd,
          l.ivaTasa,
          l.ivaUsd,
          l.totalUsd,
          l.costoUnitarioUsd,
        ],
      );

      if (l.esBien && l.productoId) {
        await aplicarMovimiento(cliente, {
          productoId: l.productoId,
          sucursalId,
          delta: -l.cantidad,
          tipo: 'SALIDA',
          costoUnitarioUsd: l.costoUnitarioUsd,
          referenciaTipo: 'VENTA',
          referenciaId: ventaId,
          nota: `Venta ${numero}`,
          usuarioId: sesion.id,
        });
      }
    }

    for (const p of pagos) {
      await cliente.query(
        `INSERT INTO pago (tipo, venta_id, metodo, moneda, tasa, monto_usd, monto_bs, igtf_usd, referencia, usuario_id)
         VALUES ('COBRO',$1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [ventaId, p.metodo, p.moneda, tasa, p.montoUsd, p.montoBs, p.igtfUsd, p.referencia, sesion.id],
      );
    }

    await registrarAuditoria(cliente, sesion.id, 'VENTA_CREADA', 'venta', ventaId, {
      numero,
      total_usd: usd(montoFactura + igtf),
    });

    return obtenerVenta(ventaId, cliente);
  });
}

/**
 * Calcula los totales de una venta sin persistir nada. El punto de venta lo usa
 * para mostrar el total antes de cobrar, y garantiza que el monto que el cajero
 * recibe es exactamente el que la venta va a exigir.
 */
export async function cotizarVenta(entrada: VentaEntrada) {
  if (!entrada.lineas?.length) throw solicitudInvalida('La venta debe tener al menos una linea');

  const tasa = (await tasaVigente()).valor;
  const lineas = await calcularLineas(pool, entrada.lineas);

  const subtotal = usd(lineas.reduce((a, l) => a + l.cantidad * l.precioUsd, 0));
  const descuentoLineas = usd(lineas.reduce((a, l) => a + l.descuentoUsd, 0));
  const descuentoGlobal = usd(Math.max(entrada.descuentoUsd ?? 0, 0));
  const descuentoTotal = usd(descuentoLineas + descuentoGlobal);
  if (descuentoTotal > subtotal + EPSILON) throw solicitudInvalida('El descuento no puede superar el subtotal');

  const baseImponible = usd(subtotal - descuentoTotal);
  const factorGlobal = subtotal - descuentoLineas > 0 ? 1 - descuentoGlobal / (subtotal - descuentoLineas) : 1;
  const ivaTotal = usd(lineas.reduce((a, l) => a + l.ivaUsd * factorGlobal, 0));
  const montoFactura = usd(baseImponible + ivaTotal);

  const pagos = await calcularPagos(pool, entrada.pagos ?? [], tasa);
  const igtf = usd(pagos.reduce((a, p) => a + p.igtfUsd, 0));
  const pagado = usd(pagos.reduce((a, p) => a + p.montoUsd, 0));

  return {
    tasa,
    lineas,
    pagos,
    subtotal_usd: subtotal,
    descuento_usd: descuentoTotal,
    base_imponible_usd: baseImponible,
    iva_usd: ivaTotal,
    /** Lo que debe cubrirse con pagos. */
    monto_factura_usd: montoFactura,
    igtf_usd: igtf,
    /** Lo que el cliente entrega en total, incluyendo el IGTF. */
    total_usd: usd(montoFactura + igtf),
    pagado_usd: pagado,
    saldo_usd: usd(montoFactura - pagado),
    monto_factura_bs: usdABolivares(montoFactura, tasa),
    total_bs: usdABolivares(usd(montoFactura + igtf), tasa),
  };
}

async function calcularLineas(cliente: Consultable, entradas: LineaEntrada[]): Promise<LineaCalculada[]> {
  const salida: LineaCalculada[] = [];

  for (const [indice, e] of entradas.entries()) {
    const cant = redCantidad(e.cantidad);
    if (!(cant > 0)) throw solicitudInvalida(`Linea ${indice + 1}: la cantidad debe ser mayor que cero`);

    let productoId: number | null = e.productoId ?? null;
    let descripcion = e.descripcion ?? '';
    let precio = e.precioUsd;
    let ivaTasa = e.ivaTasa;
    let costo = 0;
    let esBien = false;

    if (productoId) {
      const p = await uno<{ id: number; nombre: string; precio_usd: number; costo_usd: number; iva_tasa: number; tipo: string; activo: boolean }>(
        'SELECT id, nombre, precio_usd, costo_usd, iva_tasa, tipo, activo FROM producto WHERE id = $1',
        [productoId],
        cliente,
      );
      if (!p) throw noEncontrado(`Linea ${indice + 1}: el producto ${productoId} no existe`);
      if (!p.activo) throw solicitudInvalida(`Linea ${indice + 1}: el producto "${p.nombre}" esta inactivo`);
      descripcion = descripcion || p.nombre;
      precio = precio ?? Number(p.precio_usd);
      ivaTasa = ivaTasa ?? Number(p.iva_tasa);
      costo = Number(p.costo_usd);
      esBien = p.tipo === 'BIEN';
    }

    if (!descripcion) throw solicitudInvalida(`Linea ${indice + 1}: falta la descripcion`);
    if (precio === undefined || !(precio >= 0)) {
      throw solicitudInvalida(`Linea ${indice + 1}: precio invalido`);
    }

    const precioUsd = usd(precio);
    const descuentoUsd = usd(Math.max(e.descuentoUsd ?? 0, 0));
    const bruto = usd(cant * precioUsd);
    if (descuentoUsd > bruto + EPSILON) {
      throw solicitudInvalida(`Linea ${indice + 1}: el descuento supera el monto de la linea`);
    }
    const neto = usd(bruto - descuentoUsd);
    const tasaIva = ivaTasa ?? 0;
    const ivaUsd = porcentaje(neto, tasaIva);

    salida.push({
      productoId,
      descripcion,
      cantidad: cant,
      precioUsd,
      descuentoUsd,
      ivaTasa: tasaIva,
      ivaUsd,
      totalUsd: usd(neto + ivaUsd),
      costoUnitarioUsd: usd(costo),
      esBien,
    });
  }

  return salida;
}

export interface PagoCalculado {
  metodo: string;
  moneda: 'USD' | 'VES';
  montoUsd: number;
  montoBs: number;
  igtfUsd: number;
  referencia: string;
}

/**
 * Valida los metodos de pago y calcula el IGTF. El impuesto solo grava lo
 * cobrado en divisa (efectivo USD, Zelle, USDT), no los pagos en bolivares.
 */
export async function calcularPagos(
  cliente: Consultable,
  pagos: PagoEntrada[],
  tasa: number,
): Promise<PagoCalculado[]> {
  if (pagos.length === 0) return [];

  const igtfTasa = Number(
    (await uno<{ igtf_tasa: number }>('SELECT igtf_tasa FROM organizacion ORDER BY id LIMIT 1', [], cliente))
      ?.igtf_tasa ?? 3,
  );

  const salida: PagoCalculado[] = [];
  for (const [indice, p] of pagos.entries()) {
    const metodo = await uno<{ codigo: string; moneda: 'USD' | 'VES'; aplica_igtf: boolean; activo: boolean; nombre: string }>(
      'SELECT codigo, moneda, aplica_igtf, activo, nombre FROM metodo_pago WHERE codigo = $1',
      [p.metodo],
      cliente,
    );
    if (!metodo) throw solicitudInvalida(`Pago ${indice + 1}: metodo "${p.metodo}" desconocido`);
    if (!metodo.activo) throw solicitudInvalida(`Pago ${indice + 1}: el metodo "${metodo.nombre}" esta desactivado`);

    const montoUsd = usd(p.montoUsd);
    if (!(montoUsd > 0)) throw solicitudInvalida(`Pago ${indice + 1}: el monto debe ser mayor que cero`);

    salida.push({
      metodo: metodo.codigo,
      moneda: metodo.moneda,
      montoUsd,
      montoBs: usdABolivares(montoUsd, tasa),
      igtfUsd: metodo.aplica_igtf ? porcentaje(montoUsd, igtfTasa) : 0,
      referencia: p.referencia ?? '',
    });
  }
  return salida;
}

async function verificarCredito(cliente: pg.PoolClient, clienteId: number, nuevoSaldo: number) {
  const fila = await uno<{ nombre: string; limite_credito_usd: number; deuda: number }>(
    `SELECT c.nombre, c.limite_credito_usd,
            COALESCE((SELECT SUM(saldo_usd) FROM venta
                       WHERE cliente_id = c.id AND estado = 'EMITIDA' AND saldo_usd > 0), 0) AS deuda
       FROM cliente c WHERE c.id = $1`,
    [clienteId],
    cliente,
  );
  if (!fila) throw noEncontrado(`El cliente ${clienteId} no existe`);
  const limite = Number(fila.limite_credito_usd);
  if (limite <= 0) return; // 0 = sin limite configurado
  const proyectada = usd(Number(fila.deuda) + nuevoSaldo);
  if (proyectada > limite + EPSILON) {
    throw conflicto(
      `"${fila.nombre}" supera su limite de credito: deuda proyectada ${proyectada.toFixed(2)} USD sobre un limite de ${limite.toFixed(2)} USD`,
      { deudaActual: Number(fila.deuda), limite, solicitado: nuevoSaldo },
    );
  }
}

async function resolverSucursal(cliente: pg.PoolClient, sugerida?: number | null): Promise<number> {
  if (sugerida) {
    const s = await uno<{ id: number; activa: boolean }>('SELECT id, activa FROM sucursal WHERE id = $1', [sugerida], cliente);
    if (!s) throw noEncontrado(`La sucursal ${sugerida} no existe`);
    if (!s.activa) throw solicitudInvalida('La sucursal indicada esta inactiva');
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

export async function registrarAuditoria(
  cliente: pg.PoolClient,
  usuarioId: number | null,
  accion: string,
  entidad: string,
  entidadId: number | string | null,
  datos: Record<string, unknown> = {},
) {
  await cliente.query(
    'INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, datos) VALUES ($1,$2,$3,$4,$5)',
    [usuarioId, accion, entidad, entidadId === null ? null : String(entidadId), JSON.stringify(datos)],
  );
}

/** Anula una venta y devuelve la mercancia al inventario. */
export async function anularVenta(ventaId: number, motivo: string, sesion: Sesion) {
  return enTransaccion(async (cliente) => {
    const venta = await uno<{ id: number; numero: string; estado: string; sucursal_id: number }>(
      'SELECT id, numero, estado, sucursal_id FROM venta WHERE id = $1 FOR UPDATE',
      [ventaId],
      cliente,
    );
    if (!venta) throw noEncontrado('La venta no existe');
    if (venta.estado === 'ANULADA') throw conflicto('La venta ya estaba anulada');

    const lineas = await consultar<{ producto_id: number | null; cantidad: number; costo_unitario_usd: number }>(
      `SELECT vl.producto_id, vl.cantidad, vl.costo_unitario_usd
         FROM venta_linea vl JOIN producto p ON p.id = vl.producto_id
        WHERE vl.venta_id = $1 AND p.tipo = 'BIEN'`,
      [ventaId],
      cliente,
    );

    for (const l of lineas) {
      if (!l.producto_id) continue;
      await aplicarMovimiento(cliente, {
        productoId: l.producto_id,
        sucursalId: venta.sucursal_id,
        delta: Number(l.cantidad),
        tipo: 'ENTRADA',
        costoUnitarioUsd: Number(l.costo_unitario_usd),
        referenciaTipo: 'VENTA',
        referenciaId: ventaId,
        nota: `Anulacion de ${venta.numero}`,
        usuarioId: sesion.id,
      });
    }

    await cliente.query(
      `UPDATE venta SET estado = 'ANULADA', saldo_usd = 0, anulada_en = now(), anulada_motivo = $2 WHERE id = $1`,
      [ventaId, motivo],
    );
    await registrarAuditoria(cliente, sesion.id, 'VENTA_ANULADA', 'venta', ventaId, { numero: venta.numero, motivo });

    return obtenerVenta(ventaId, cliente);
  });
}

/** Registra un abono a una venta a credito y recalcula su saldo. */
export async function abonarVenta(
  ventaId: number,
  pago: PagoEntrada,
  sesion: Sesion,
) {
  return enTransaccion(async (cliente) => {
    const venta = await uno<{ id: number; numero: string; estado: string; saldo_usd: number }>(
      'SELECT id, numero, estado, saldo_usd FROM venta WHERE id = $1 FOR UPDATE',
      [ventaId],
      cliente,
    );
    if (!venta) throw noEncontrado('La venta no existe');
    if (venta.estado === 'ANULADA') throw conflicto('No se puede abonar una venta anulada');

    const saldo = usd(Number(venta.saldo_usd));
    if (saldo <= EPSILON) throw conflicto('La venta ya esta totalmente pagada');

    const tasa = (await tasaVigente(undefined, cliente)).valor;
    const [calculado] = await calcularPagos(cliente, [pago], tasa);
    if (calculado.montoUsd > saldo + EPSILON) {
      throw solicitudInvalida(
        `El abono (${calculado.montoUsd.toFixed(2)} USD) supera el saldo pendiente (${saldo.toFixed(2)} USD)`,
      );
    }

    await cliente.query(
      `INSERT INTO pago (tipo, venta_id, metodo, moneda, tasa, monto_usd, monto_bs, igtf_usd, referencia, usuario_id)
       VALUES ('COBRO',$1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [ventaId, calculado.metodo, calculado.moneda, tasa, calculado.montoUsd, calculado.montoBs, calculado.igtfUsd, calculado.referencia, sesion.id],
    );

    await cliente.query(
      `UPDATE venta
          SET pagado_usd = usd.pagado,
              saldo_usd  = GREATEST(base_imponible_usd + iva_usd - usd.pagado, 0),
              igtf_usd   = usd.igtf,
              total_usd  = base_imponible_usd + iva_usd + usd.igtf
         FROM (SELECT COALESCE(SUM(monto_usd),0) AS pagado, COALESCE(SUM(igtf_usd),0) AS igtf
                 FROM pago WHERE venta_id = $1) usd
        WHERE venta.id = $1`,
      [ventaId],
    );

    await registrarAuditoria(cliente, sesion.id, 'VENTA_ABONADA', 'venta', ventaId, {
      numero: venta.numero,
      monto_usd: calculado.montoUsd,
    });

    return obtenerVenta(ventaId, cliente);
  });
}

export async function obtenerVenta(ventaId: number, cliente?: pg.PoolClient) {
  const ejecutor = cliente as any;
  const venta = await uno(
    `SELECT v.*, c.nombre AS cliente_nombre, c.documento AS cliente_documento,
            c.tipo_documento AS cliente_tipo_documento,
            s.nombre AS sucursal_nombre, u.nombre AS usuario_nombre
       FROM venta v
       LEFT JOIN cliente c ON c.id = v.cliente_id
       LEFT JOIN sucursal s ON s.id = v.sucursal_id
       LEFT JOIN usuario u ON u.id = v.usuario_id
      WHERE v.id = $1`,
    [ventaId],
    ejecutor,
  );
  if (!venta) throw noEncontrado('La venta no existe');

  const lineas = await consultar(
    `SELECT vl.*, p.sku FROM venta_linea vl LEFT JOIN producto p ON p.id = vl.producto_id
      WHERE vl.venta_id = $1 ORDER BY vl.id`,
    [ventaId],
    ejecutor,
  );
  const pagos = await consultar(
    `SELECT pg.*, mp.nombre AS metodo_nombre FROM pago pg
       JOIN metodo_pago mp ON mp.codigo = pg.metodo
      WHERE pg.venta_id = $1 ORDER BY pg.id`,
    [ventaId],
    ejecutor,
  );

  const tasa = Number((venta as any).tasa);
  return {
    ...venta,
    lineas,
    pagos,
    totales_bs: {
      base_imponible: usdABolivares(Number((venta as any).base_imponible_usd), tasa),
      iva: usdABolivares(Number((venta as any).iva_usd), tasa),
      igtf: usdABolivares(Number((venta as any).igtf_usd), tasa),
      total: usdABolivares(Number((venta as any).total_usd), tasa),
    },
  };
}

export interface FiltroVentas {
  desde?: string;
  hasta?: string;
  clienteId?: number;
  sucursalId?: number;
  estado?: 'EMITIDA' | 'ANULADA';
  soloPendientes?: boolean;
  texto?: string;
  pagina: number;
  porPagina: number;
}

export async function listarVentas(f: FiltroVentas) {
  const condiciones: string[] = ['1=1'];
  const params: unknown[] = [];
  const add = (sql: string, valor: unknown) => {
    params.push(valor);
    condiciones.push(sql.replace('?', `$${params.length}`));
  };

  if (f.desde) add('v.fecha >= ?::date', f.desde);
  if (f.hasta) add("v.fecha < (?::date + interval '1 day')", f.hasta);
  if (f.clienteId) add('v.cliente_id = ?', f.clienteId);
  if (f.sucursalId) add('v.sucursal_id = ?', f.sucursalId);
  if (f.estado) add('v.estado = ?', f.estado);
  if (f.soloPendientes) condiciones.push("v.estado = 'EMITIDA' AND v.saldo_usd > 0.005");
  if (f.texto) {
    params.push(`%${f.texto}%`);
    const i = params.length;
    condiciones.push(`(v.numero ILIKE $${i} OR c.nombre ILIKE $${i})`);
  }

  const donde = condiciones.join(' AND ');
  const desplazamiento = (f.pagina - 1) * f.porPagina;

  const filas = await consultar(
    `SELECT v.id, v.numero, v.fecha, v.condicion, v.estado, v.tasa,
            v.total_usd, v.saldo_usd, v.iva_usd, v.igtf_usd, v.vence_el,
            c.nombre AS cliente_nombre, s.nombre AS sucursal_nombre, u.nombre AS usuario_nombre
       FROM venta v
       LEFT JOIN cliente c ON c.id = v.cliente_id
       LEFT JOIN sucursal s ON s.id = v.sucursal_id
       LEFT JOIN usuario u ON u.id = v.usuario_id
      WHERE ${donde}
      ORDER BY v.fecha DESC, v.id DESC
      LIMIT ${f.porPagina} OFFSET ${desplazamiento}`,
    params,
  );

  const total = await uno<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM venta v LEFT JOIN cliente c ON c.id = v.cliente_id WHERE ${donde}`,
    params,
  );

  return { datos: filas, total: total?.n ?? 0, pagina: f.pagina, porPagina: f.porPagina };
}
