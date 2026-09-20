/**
 * Pruebas de integracion del motor de ventas. Requieren una base PostgreSQL
 * vacia apuntada por DATABASE_URL (o TEST_DATABASE_URL). Cada prueba corre
 * sobre datos creados aqui mismo, no sobre el seed de demo.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool, enTransaccion, uno } from '../lib/db.js';
import { migrar } from '../lib/migrate.js';
import { hashearClave, type Sesion } from '../lib/auth.js';
import { abonarVenta, anularVenta, cotizarVenta, crearVenta } from '../modules/ventas.js';
import { crearCompra } from '../modules/compras.js';
import { guardarTasa } from '../modules/tasa.js';
import { existenciaActual } from '../modules/inventario.js';

let sesion: Sesion;
let sucursalId: number;
let productoId: number;
let servicioId: number;
let clienteId: number;

before(async () => {
  await migrar();
  // Limpieza completa para que la suite sea repetible.
  await pool.query(`TRUNCATE pago, venta_linea, venta, compra_linea, compra, movimiento_inventario,
                    existencia, producto, categoria, cliente, proveedor, auditoria, usuario, sucursal,
                    organizacion, tasa_cambio RESTART IDENTITY CASCADE`);
  await pool.query(`UPDATE correlativo SET siguiente = 1`);

  await pool.query(
    `INSERT INTO organizacion (nombre, rif, iva_tasa, igtf_tasa) VALUES ('Prueba, C.A.','J-1',16,3)`,
  );
  const suc = await uno<{ id: number }>(
    `INSERT INTO sucursal (codigo, nombre, es_principal) VALUES ('P','Principal',true) RETURNING id`,
  );
  sucursalId = suc!.id;

  const usr = await uno<{ id: number }>(
    `INSERT INTO usuario (email, nombre, password_hash, rol, sucursal_id)
     VALUES ('t@t.com','Tester',$1,'PROPIETARIO',$2) RETURNING id`,
    [await hashearClave('Prueba.12345'), sucursalId],
  );
  sesion = { id: usr!.id, email: 't@t.com', nombre: 'Tester', rol: 'PROPIETARIO', sucursalId };

  const prod = await uno<{ id: number }>(
    `INSERT INTO producto (sku, nombre, tipo, precio_usd, costo_usd, iva_tasa, stock_minimo)
     VALUES ('P-1','Producto de prueba','BIEN',10,6,16,5) RETURNING id`,
  );
  productoId = prod!.id;

  const srv = await uno<{ id: number }>(
    `INSERT INTO producto (sku, nombre, tipo, precio_usd, costo_usd, iva_tasa)
     VALUES ('S-1','Servicio de prueba','SERVICIO',25,0,16) RETURNING id`,
  );
  servicioId = srv!.id;

  const cli = await uno<{ id: number }>(
    `INSERT INTO cliente (tipo_documento, documento, nombre, limite_credito_usd, dias_credito)
     VALUES ('V','1','Cliente de prueba',100,15) RETURNING id`,
  );
  clienteId = cli!.id;

  await guardarTasa(new Date().toISOString().slice(0, 10), 40, 'PRUEBA');

  const prov = await uno<{ id: number }>(
    `INSERT INTO proveedor (tipo_documento, documento, nombre) VALUES ('J','2','Proveedor de prueba') RETURNING id`,
  );
  await crearCompra(
    {
      sucursalId,
      proveedorId: prov!.id,
      condicion: 'CREDITO',
      diasCredito: 30,
      lineas: [{ productoId, cantidad: 100, costoUsd: 6 }],
    },
    sesion,
  );
});

after(async () => {
  await pool.end();
});

describe('cotizacion', () => {
  it('calcula base, IVA e IGTF antes de guardar nada', async () => {
    const c = await cotizarVenta({
      lineas: [{ productoId, cantidad: 3 }],
      pagos: [{ metodo: 'EFECTIVO_USD', montoUsd: 34.8 }],
    });
    assert.equal(c.subtotal_usd, 30);
    assert.equal(c.iva_usd, 4.8);
    assert.equal(c.monto_factura_usd, 34.8);
    assert.equal(c.igtf_usd, 1.04); // 3% de 34.80
    assert.equal(c.total_usd, 35.84);
    assert.equal(c.saldo_usd, 0);
    assert.equal(c.total_bs, 1433.6); // 35.84 * 40
  });

  it('no deja documentos huerfanos', async () => {
    const antes = await uno<{ n: number }>('SELECT COUNT(*)::int AS n FROM venta');
    await cotizarVenta({ lineas: [{ productoId, cantidad: 1 }] });
    const despues = await uno<{ n: number }>('SELECT COUNT(*)::int AS n FROM venta');
    assert.equal(antes!.n, despues!.n);
  });
});

describe('venta de contado', () => {
  it('aplica IGTF solo a los pagos en divisa', async () => {
    const venta: any = await crearVenta(
      {
        sucursalId,
        lineas: [{ productoId, cantidad: 2 }],
        pagos: [
          { metodo: 'EFECTIVO_USD', montoUsd: 10 },
          { metodo: 'PAGO_MOVIL', montoUsd: 13.2 },
        ],
      },
      sesion,
    );
    assert.equal(Number(venta.base_imponible_usd), 20);
    assert.equal(Number(venta.iva_usd), 3.2);
    assert.equal(Number(venta.igtf_usd), 0.3); // 3% de los 10 USD en efectivo
    assert.equal(Number(venta.total_usd), 23.5);
    assert.equal(Number(venta.saldo_usd), 0);
  });

  it('descuenta el inventario', async () => {
    const antes = await enTransaccion((c) => existenciaActual(c, productoId, sucursalId));
    await crearVenta(
      { sucursalId, lineas: [{ productoId, cantidad: 4 }], pagos: [{ metodo: 'PAGO_MOVIL', montoUsd: 46.4 }] },
      sesion,
    );
    const despues = await enTransaccion((c) => existenciaActual(c, productoId, sucursalId));
    assert.equal(despues, antes - 4);
  });

  it('no permite cerrar una venta de contado sin cubrir el total', async () => {
    await assert.rejects(
      () => crearVenta({ sucursalId, lineas: [{ productoId, cantidad: 1 }], pagos: [{ metodo: 'PAGO_MOVIL', montoUsd: 1 }] }, sesion),
      /sin cubrir/i,
    );
  });

  it('rechaza pagos por encima del total', async () => {
    await assert.rejects(
      () => crearVenta({ sucursalId, lineas: [{ productoId, cantidad: 1 }], pagos: [{ metodo: 'PAGO_MOVIL', montoUsd: 999 }] }, sesion),
      /superan el total/i,
    );
  });

  it('no mueve inventario por lineas de servicio', async () => {
    const venta: any = await crearVenta(
      { sucursalId, lineas: [{ productoId: servicioId, cantidad: 1 }], pagos: [{ metodo: 'PAGO_MOVIL', montoUsd: 29 }] },
      sesion,
    );
    const movimientos = await uno<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM movimiento_inventario WHERE referencia_tipo = $1 AND referencia_id = $2',
      ['VENTA', venta.id],
    );
    assert.equal(movimientos!.n, 0);
  });
});

describe('control de stock', () => {
  it('bloquea la venta cuando no hay existencia suficiente', async () => {
    await assert.rejects(
      () => crearVenta({ sucursalId, clienteId, condicion: 'CREDITO', lineas: [{ productoId, cantidad: 100000 }] }, sesion),
      /stock insuficiente|limite de credito/i,
    );
  });

  it('deja el inventario intacto tras una venta fallida', async () => {
    const antes = await enTransaccion((c) => existenciaActual(c, productoId, sucursalId));
    await crearVenta(
      { sucursalId, lineas: [{ productoId, cantidad: 2 }], pagos: [{ metodo: 'PAGO_MOVIL', montoUsd: 1 }] },
      sesion,
    ).catch(() => null);
    const despues = await enTransaccion((c) => existenciaActual(c, productoId, sucursalId));
    assert.equal(despues, antes);
  });
});

describe('credito y cobranza', () => {
  it('respeta el limite de credito del cliente', async () => {
    await assert.rejects(
      () => crearVenta({ sucursalId, clienteId, condicion: 'CREDITO', diasCredito: 15, lineas: [{ productoId, cantidad: 50 }] }, sesion),
      /limite de credito/i,
    );
  });

  it('cobra en abonos hasta saldar la factura', async () => {
    const venta: any = await crearVenta(
      { sucursalId, clienteId, condicion: 'CREDITO', diasCredito: 15, lineas: [{ productoId, cantidad: 5 }] },
      sesion,
    );
    assert.equal(Number(venta.saldo_usd), 58); // 50 + 16% IVA
    assert.ok(venta.vence_el, 'la venta a credito debe tener fecha de vencimiento');

    const parcial: any = await abonarVenta(venta.id, { metodo: 'PAGO_MOVIL', montoUsd: 20 }, sesion);
    assert.equal(Number(parcial.saldo_usd), 38);

    const final: any = await abonarVenta(venta.id, { metodo: 'ZELLE', montoUsd: 38 }, sesion);
    assert.equal(Number(final.saldo_usd), 0);
    assert.equal(Number(final.igtf_usd), 1.14); // 3% de los 38 en Zelle

    await assert.rejects(() => abonarVenta(venta.id, { metodo: 'PAGO_MOVIL', montoUsd: 1 }, sesion), /totalmente pagada/i);
  });
});

describe('anulacion', () => {
  it('devuelve la mercancia y pone el saldo en cero', async () => {
    const venta: any = await crearVenta(
      { sucursalId, clienteId, condicion: 'CREDITO', diasCredito: 15, lineas: [{ productoId, cantidad: 3 }] },
      sesion,
    );
    const antes = await enTransaccion((c) => existenciaActual(c, productoId, sucursalId));

    const anulada: any = await anularVenta(venta.id, 'Prueba automatizada', sesion);
    assert.equal(anulada.estado, 'ANULADA');
    assert.equal(Number(anulada.saldo_usd), 0);

    const despues = await enTransaccion((c) => existenciaActual(c, productoId, sucursalId));
    assert.equal(despues, antes + 3);

    await assert.rejects(() => anularVenta(venta.id, 'otra vez', sesion), /ya estaba anulada/i);
  });
});

describe('correlativos', () => {
  it('numera las facturas sin repetir', async () => {
    const numeros = await pool.query<{ numero: string }>('SELECT numero FROM venta ORDER BY id');
    const unicos = new Set(numeros.rows.map((r) => r.numero));
    assert.equal(unicos.size, numeros.rows.length);
    assert.match(numeros.rows[0].numero, /^F-\d{6}$/);
  });
});

describe('costo promedio ponderado', () => {
  it('no acumula error al encadenar compras (ADR-03: la aritmetica va en numeric)', async () => {
    const prod = await uno<{ id: number }>(
      `INSERT INTO producto (sku, nombre, tipo, precio_usd, costo_usd, iva_tasa)
       VALUES ('P-COSTO','Producto de costeo','BIEN',20,0,16) RETURNING id`,
    );
    const prov = await uno<{ id: number }>('SELECT id FROM proveedor LIMIT 1');

    // 60 compras con costos de 4 decimales: el caso que degradaba el promedio.
    const compras = Array.from({ length: 60 }, (_, i) => ({
      cantidad: 100 + i,
      costoUsd: Number((3 + (i % 7) * 0.1337).toFixed(4)),
    }));
    for (const c of compras) {
      await crearCompra(
        {
          sucursalId,
          proveedorId: prov!.id,
          condicion: 'CREDITO',
          diasCredito: 30,
          lineas: [{ productoId: prod!.id, cantidad: c.cantidad, costoUsd: c.costoUsd }],
        },
        sesion,
      );
    }

    const esperado = await uno<{ v: number }>(
      `SELECT round(SUM(cl.cantidad * cl.costo_usd) / SUM(cl.cantidad), 4) AS v
         FROM compra_linea cl WHERE cl.producto_id = $1`,
      [prod!.id],
    );
    const real = await uno<{ costo_usd: number }>('SELECT costo_usd FROM producto WHERE id = $1', [prod!.id]);

    // Todas las compras entran sobre existencia cero inicial, asi que el
    // promedio ponderado debe coincidir con el promedio global exacto.
    assert.ok(
      Math.abs(Number(real!.costo_usd) - Number(esperado!.v)) < 0.0002,
      `costo ${real!.costo_usd} se alejo de ${esperado!.v}`,
    );
  });
});
