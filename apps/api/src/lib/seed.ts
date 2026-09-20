/**
 * Carga inicial. Es idempotente: si la organizacion ya existe no toca nada,
 * salvo que se pase --forzar-demo para volver a generar datos de ejemplo.
 */
import { pool, enTransaccion, uno } from './db.js';
import { env } from './env.js';
import { hashearClave } from './auth.js';
import { migrar } from './migrate.js';
import { cotizarVenta, crearVenta } from '../modules/ventas.js';
import { abonarCompra, crearCompra } from '../modules/compras.js';
import { guardarTasa } from '../modules/tasa.js';
import type { Sesion } from './auth.js';

const conDemo = !process.argv.includes('--sin-demo');

const CATEGORIAS = ['Bebidas', 'Alimentos', 'Limpieza', 'Cuidado personal', 'Papeleria', 'Servicios'];

const PRODUCTOS: Array<{ sku: string; nombre: string; categoria: string; precio: number; costo: number; minimo: number; tipo?: 'BIEN' | 'SERVICIO'; iva?: number }> = [
  { sku: 'BEB-001', nombre: 'Refresco 2L', categoria: 'Bebidas', precio: 2.4, costo: 1.55, minimo: 24 },
  { sku: 'BEB-002', nombre: 'Agua mineral 600ml', categoria: 'Bebidas', precio: 0.7, costo: 0.38, minimo: 48 },
  { sku: 'BEB-003', nombre: 'Jugo de naranja 1L', categoria: 'Bebidas', precio: 1.9, costo: 1.2, minimo: 18 },
  { sku: 'ALI-001', nombre: 'Harina de maiz 1kg', categoria: 'Alimentos', precio: 1.35, costo: 0.95, minimo: 40 },
  { sku: 'ALI-002', nombre: 'Arroz blanco 1kg', categoria: 'Alimentos', precio: 1.5, costo: 1.05, minimo: 40 },
  { sku: 'ALI-003', nombre: 'Aceite vegetal 1L', categoria: 'Alimentos', precio: 2.8, costo: 2.05, minimo: 20 },
  { sku: 'ALI-004', nombre: 'Pasta larga 1kg', categoria: 'Alimentos', precio: 1.25, costo: 0.85, minimo: 30 },
  { sku: 'ALI-005', nombre: 'Cafe molido 250g', categoria: 'Alimentos', precio: 3.6, costo: 2.6, minimo: 15 },
  { sku: 'LIM-001', nombre: 'Detergente en polvo 1kg', categoria: 'Limpieza', precio: 2.95, costo: 2.1, minimo: 12 },
  { sku: 'LIM-002', nombre: 'Cloro 1L', categoria: 'Limpieza', precio: 1.1, costo: 0.65, minimo: 20 },
  { sku: 'LIM-003', nombre: 'Jabon azul', categoria: 'Limpieza', precio: 0.9, costo: 0.55, minimo: 30 },
  { sku: 'CUI-001', nombre: 'Shampoo 400ml', categoria: 'Cuidado personal', precio: 4.2, costo: 3.0, minimo: 10 },
  { sku: 'CUI-002', nombre: 'Pasta dental 100g', categoria: 'Cuidado personal', precio: 1.8, costo: 1.15, minimo: 18 },
  { sku: 'CUI-003', nombre: 'Papel higienico x4', categoria: 'Cuidado personal', precio: 2.25, costo: 1.6, minimo: 24 },
  { sku: 'PAP-001', nombre: 'Cuaderno universitario', categoria: 'Papeleria', precio: 1.75, costo: 1.1, minimo: 15 },
  { sku: 'PAP-002', nombre: 'Boligrafo azul', categoria: 'Papeleria', precio: 0.45, costo: 0.22, minimo: 50 },
  { sku: 'SRV-001', nombre: 'Delivery a domicilio', categoria: 'Servicios', precio: 3.0, costo: 1.2, minimo: 0, tipo: 'SERVICIO' },
  { sku: 'SRV-002', nombre: 'Instalacion y armado', categoria: 'Servicios', precio: 15.0, costo: 6.0, minimo: 0, tipo: 'SERVICIO' },
];

const CLIENTES = [
  { tipo: 'V', doc: '12345678', nombre: 'Maria Gonzalez', tel: '0412-1112233', credito: 300, dias: 15 },
  { tipo: 'V', doc: '18456789', nombre: 'Carlos Rodriguez', tel: '0414-2223344', credito: 500, dias: 30 },
  { tipo: 'J', doc: '409876543', nombre: 'Bodegon La Esquina, C.A.', tel: '0212-5556677', credito: 1200, dias: 30 },
  { tipo: 'V', doc: '20987654', nombre: 'Ana Perez', tel: '0424-3334455', credito: 0, dias: 0 },
  { tipo: 'J', doc: '401122334', nombre: 'Inversiones El Trigal, C.A.', tel: '0241-7778899', credito: 800, dias: 21 },
  { tipo: 'V', doc: '15678901', nombre: 'Jose Ramirez', tel: '0416-4445566', credito: 0, dias: 0 },
];

const PROVEEDORES = [
  { tipo: 'J', doc: '301234567', nombre: 'Distribuidora Central, C.A.', tel: '0212-1234567' },
  { tipo: 'J', doc: '302345678', nombre: 'Alimentos del Valle, S.A.', tel: '0243-7654321' },
  { tipo: 'J', doc: '303456789', nombre: 'Mayorista Express', tel: '0251-9876543' },
];

const METODOS_CONTADO = ['EFECTIVO_USD', 'PAGO_MOVIL', 'EFECTIVO_BS', 'PUNTO_VENTA', 'ZELLE', 'TRANSFERENCIA'];

/** PRNG con semilla fija: el seed produce siempre el mismo set de demo. */
function generador(semilla: number) {
  let estado = semilla;
  return () => {
    estado = (estado * 1664525 + 1013904223) % 4294967296;
    return estado / 4294967296;
  };
}

async function sembrar() {
  await migrar();

  const yaExiste = await uno<{ id: number }>('SELECT id FROM organizacion ORDER BY id LIMIT 1');
  if (yaExiste) {
    console.log('[seed] la organizacion ya esta creada; no se toca nada.');
    return;
  }

  const azar = generador(20260920);

  const { sesion } = await enTransaccion(async (cliente) => {
    await cliente.query(
      `INSERT INTO organizacion (nombre, rif, moneda_base, iva_tasa, igtf_tasa, direccion, telefono, email)
       VALUES ($1,$2,$3,$4,$5,'','','')`,
      [env.org.nombre, env.org.rif, env.org.monedaBase, env.ivaTasa, env.igtfTasa],
    );

    const principal = await uno<{ id: number }>(
      `INSERT INTO sucursal (codigo, nombre, direccion, es_principal) VALUES ('PRIN','Tienda principal','',true) RETURNING id`,
      [], cliente,
    );
    // El deposito solo se crea con datos de ejemplo; una instalacion limpia
    // arranca con una sola sucursal y el resto se crea desde Configuracion.
    const deposito = conDemo
      ? await uno<{ id: number }>(
          `INSERT INTO sucursal (codigo, nombre, direccion) VALUES ('DEP','Deposito','') RETURNING id`,
          [], cliente,
        )
      : null;

    const admin = await uno<{ id: number; email: string; nombre: string; rol: Sesion['rol'] }>(
      `INSERT INTO usuario (email, nombre, password_hash, rol, sucursal_id)
       VALUES ($1,$2,$3,'PROPIETARIO',$4) RETURNING id, email, nombre, rol`,
      [env.admin.email.toLowerCase(), env.admin.nombre, await hashearClave(env.admin.password), principal!.id],
      cliente,
    );

    if (conDemo) {
      await cliente.query(
        `INSERT INTO usuario (email, nombre, password_hash, rol, sucursal_id) VALUES ($1,$2,$3,'VENDEDOR',$4)`,
        ['caja@minegocio.com', 'Caja 1', await hashearClave('Caja.12345'), principal!.id],
      );
      await cliente.query(
        `INSERT INTO usuario (email, nombre, password_hash, rol, sucursal_id) VALUES ($1,$2,$3,'ALMACEN',$4)`,
        ['almacen@minegocio.com', 'Almacen', await hashearClave('Almacen.12345'), deposito?.id ?? principal!.id],
      );
    }

    // Catalogo, clientes y proveedores de muestra: solo en modo demo.
    if (!conDemo) {
      return {
        sesion: { id: admin!.id, email: admin!.email, nombre: admin!.nombre, rol: admin!.rol, sucursalId: principal!.id } as Sesion,
        principalId: principal!.id,
      };
    }

    for (const nombre of CATEGORIAS) {
      await cliente.query('INSERT INTO categoria (nombre) VALUES ($1) ON CONFLICT DO NOTHING', [nombre]);
    }
    for (const p of PRODUCTOS) {
      const cat = await uno<{ id: number }>('SELECT id FROM categoria WHERE nombre = $1', [p.categoria], cliente);
      await cliente.query(
        `INSERT INTO producto (sku, nombre, categoria_id, tipo, precio_usd, costo_usd, iva_tasa, stock_minimo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [p.sku, p.nombre, cat!.id, p.tipo ?? 'BIEN', p.precio, p.costo, p.iva ?? env.ivaTasa, p.minimo],
      );
    }
    for (const c of CLIENTES) {
      await cliente.query(
        `INSERT INTO cliente (tipo_documento, documento, nombre, telefono, limite_credito_usd, dias_credito)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [c.tipo, c.doc, c.nombre, c.tel, c.credito, c.dias],
      );
    }
    for (const p of PROVEEDORES) {
      await cliente.query(
        `INSERT INTO proveedor (tipo_documento, documento, nombre, telefono) VALUES ($1,$2,$3,$4)`,
        [p.tipo, p.doc, p.nombre, p.tel],
      );
    }

    return {
      sesion: { id: admin!.id, email: admin!.email, nombre: admin!.nombre, rol: admin!.rol, sucursalId: principal!.id } as Sesion,
      principalId: principal!.id,
    };
  });

  await guardarTasa(new Date().toISOString().slice(0, 10), env.tasaInicial, 'INICIAL');
  console.log(`[seed] organizacion "${env.org.nombre}" creada. Usuario: ${env.admin.email}`);

  if (!conDemo) {
    console.log('[seed] listo (sin datos de ejemplo).');
    return;
  }

  // ── Compra inicial: surtir el inventario ──────────────────────────────────
  const productos = await pool.query<{ id: number; costo_usd: number; tipo: string; stock_minimo: number }>(
    `SELECT id, costo_usd, tipo, stock_minimo FROM producto WHERE tipo = 'BIEN' ORDER BY id`,
  );
  const proveedores = await pool.query<{ id: number }>('SELECT id FROM proveedor ORDER BY id');

  const compra = await crearCompra(
    {
      proveedorId: proveedores.rows[0].id,
      documentoProveedor: 'FAC-PROV-00110',
      condicion: 'CREDITO',
      diasCredito: 30,
      nota: 'Surtido inicial de inventario',
      lineas: productos.rows.map((p) => ({
        productoId: p.id,
        cantidad: Math.max(Number(p.stock_minimo) * 12, 180),
        costoUsd: Number(p.costo_usd),
      })),
    },
    sesion,
  );
  // Abono parcial para que quede una cuenta por pagar realista.
  await abonarCompra(
    Number((compra as any).id),
    { metodo: 'TRANSFERENCIA', montoUsd: Math.round(Number((compra as any).total_usd) * 0.6 * 100) / 100, referencia: 'TRF-9981' },
    sesion,
  );

  // ── Ventas de los ultimos 45 dias ─────────────────────────────────────────
  const todos = await pool.query<{ id: number; precio_usd: number }>('SELECT id, precio_usd FROM producto ORDER BY id');
  const clientes = await pool.query<{ id: number }>('SELECT id FROM cliente ORDER BY id');

  let creadas = 0;
  for (let dia = 44; dia >= 0; dia--) {
    const facturasDelDia = 2 + Math.floor(azar() * 5);
    for (let f = 0; f < facturasDelDia; f++) {
      const nLineas = 1 + Math.floor(azar() * 4);
      const lineas = Array.from({ length: nLineas }, () => {
        const p = todos.rows[Math.floor(azar() * todos.rows.length)];
        return { productoId: p.id, cantidad: 1 + Math.floor(azar() * 4) };
      });

      const aCredito = azar() < 0.18;
      const clienteId = aCredito || azar() < 0.6 ? clientes.rows[Math.floor(azar() * clientes.rows.length)].id : null;

      try {
        if (aCredito && clienteId) {
          await crearVenta({ clienteId, condicion: 'CREDITO', diasCredito: 15, lineas }, sesion);
        } else {
          // Se cotiza primero para cobrar exactamente el total de la factura.
          const cotizacion = await cotizarVenta({ lineas });
          const metodo = METODOS_CONTADO[Math.floor(azar() * METODOS_CONTADO.length)];
          await crearVenta(
            { clienteId, condicion: 'CONTADO', lineas, pagos: [{ metodo, montoUsd: cotizacion.monto_factura_usd }] },
            sesion,
          );
        }
        creadas++;
      } catch {
        // Sin stock suficiente para esa combinacion: se salta la factura.
      }
    }
  }

  // Desplaza las fechas hacia atras para que el historico no quede todo hoy.
  await pool.query(`
    WITH numeradas AS (
      SELECT id, row_number() OVER (ORDER BY id) AS n, COUNT(*) OVER () AS total FROM venta
    )
    UPDATE venta v
       SET fecha = now() - ((44 - floor((n - 1) * 45.0 / GREATEST(total,1)))::int || ' days')::interval
                         + (n % 9) * interval '47 minutes'
      FROM numeradas WHERE numeradas.id = v.id
  `);
  await pool.query(`UPDATE pago p SET fecha = v.fecha FROM venta v WHERE v.id = p.venta_id`);
  await pool.query(`
    UPDATE venta SET vence_el = (fecha + (dias_credito || ' days')::interval)::date
     WHERE condicion = 'CREDITO' AND dias_credito > 0
  `);

  console.log(`[seed] datos de ejemplo: ${creadas} ventas, ${productos.rows.length} productos surtidos.`);
}

sembrar()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error('[seed] fallo:', error);
    await pool.end().catch(() => {});
    process.exit(1);
  });
