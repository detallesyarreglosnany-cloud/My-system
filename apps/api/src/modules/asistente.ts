import { consultar, uno } from '../lib/db.js';
import { usd, usdABolivares } from '../lib/dinero.js';
import { env } from '../lib/env.js';
import { resumen, topProductos } from './reportes.js';
import { stockBajo } from './inventario.js';
import { tasaVigente } from './tasa.js';

export interface RespuestaAsistente {
  respuesta: string;
  intencion: string;
  datos?: unknown;
  motor: 'local' | 'anthropic';
}

const money = (n: number) => `${usd(n).toFixed(2)} USD`;

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

const contiene = (t: string, ...claves: string[]) => claves.some((c) => t.includes(c));

/** Se descartan al buscar un producto por nombre dentro de la pregunta. */
const PALABRAS_VACIAS = new Set([
  'precio', 'costo', 'cuanto', 'cuantos', 'cuantas', 'queda', 'quedan', 'quedo', 'hay', 'tengo',
  'del', 'las', 'los', 'una', 'uno', 'por', 'para', 'con', 'sin', 'mas', 'menos', 'cual', 'cuales',
  'que', 'como', 'donde', 'vale', 'valen', 'cuesta', 'cuestan', 'dame', 'dime', 'muestra', 'buscar',
  'busca', 'producto', 'productos', 'sobre', 'esta', 'estan', 'son', 'tiene', 'tienen', 'unidades',
]);

/**
 * Motor local: reconoce intenciones frecuentes y responde con datos reales,
 * sin enviar nada fuera del servidor. Es el modo por defecto.
 */
export async function responderLocal(pregunta: string): Promise<RespuestaAsistente> {
  const t = normalizar(pregunta);

  if (contiene(t, 'tasa', 'dolar', 'bcv', 'cambio')) {
    const tasa = await tasaVigente();
    return {
      intencion: 'tasa',
      motor: 'local',
      datos: tasa,
      respuesta: `La tasa vigente es ${tasa.valor.toFixed(2)} Bs por dolar (fecha ${tasa.fecha}, fuente ${tasa.fuente}).`,
    };
  }

  if (contiene(t, 'stock bajo', 'stock minimo', 'se me acaba', 'acaban', 'agot', 'reponer', 'reposicion', 'poco inventario', 'me falta', 'por comprar')) {
    const filas = await stockBajo(15);
    if (filas.length === 0) {
      return { intencion: 'stock_bajo', motor: 'local', datos: [], respuesta: 'Ningun producto esta por debajo de su stock minimo.' };
    }
    const lista = filas.slice(0, 8).map((f) => `- ${f.nombre}: quedan ${f.existencia} de ${f.stock_minimo} minimo (${f.detalle})`).join('\n');
    return {
      intencion: 'stock_bajo',
      motor: 'local',
      datos: filas,
      respuesta: `Tienes ${filas.length} alerta(s) de stock bajo:\n${lista}`,
    };
  }

  if (contiene(t, 'me deben', 'por cobrar', 'deudores', 'cobranza', 'cobrar')) {
    const r = await resumen();
    const top = await consultar<{ nombre: string; saldo: number }>(
      `SELECT COALESCE(c.nombre,'Consumidor final') AS nombre, SUM(v.saldo_usd) AS saldo
         FROM venta v LEFT JOIN cliente c ON c.id = v.cliente_id
        WHERE v.estado = 'EMITIDA' AND v.saldo_usd > 0.005
        GROUP BY c.nombre ORDER BY saldo DESC LIMIT 5`,
    );
    const lista = top.map((f) => `- ${f.nombre}: ${money(Number(f.saldo))}`).join('\n');
    return {
      intencion: 'cuentas_por_cobrar',
      motor: 'local',
      datos: { resumen: r.cuentas_por_cobrar, top },
      respuesta:
        `Te deben ${money(r.cuentas_por_cobrar.total_usd)} en ${r.cuentas_por_cobrar.documentos} documento(s), ` +
        `de los cuales ${money(r.cuentas_por_cobrar.vencido_usd)} ya estan vencidos.` +
        (lista ? `\n\nMayores deudores:\n${lista}` : ''),
    };
  }

  if (contiene(t, 'debo', 'por pagar', 'proveedores', 'pagar')) {
    const r = await resumen();
    return {
      intencion: 'cuentas_por_pagar',
      motor: 'local',
      datos: r.cuentas_por_pagar,
      respuesta: `Debes ${money(r.cuentas_por_pagar.total_usd)} en ${r.cuentas_por_pagar.documentos} documento(s), con ${money(r.cuentas_por_pagar.vencido_usd)} vencidos.`,
    };
  }

  if (contiene(t, 'mas vendido', 'mejor producto', 'top producto', 'que se vende')) {
    const filas = await topProductos(5);
    if (filas.length === 0) {
      return { intencion: 'top_productos', motor: 'local', datos: [], respuesta: 'Todavia no hay ventas registradas.' };
    }
    const lista = filas.map((f: any, i: number) => `${i + 1}. ${f.nombre}: ${Number(f.unidades)} unidades, ${money(Number(f.ingreso_usd))}`).join('\n');
    return { intencion: 'top_productos', motor: 'local', datos: filas, respuesta: `Tus productos mas vendidos:\n${lista}` };
  }

  if (contiene(t, 'mejores clientes', 'quien compra', 'cliente que mas')) {
    const filas = await consultar(
      `SELECT c.nombre, COUNT(v.id)::int AS facturas, SUM(v.total_usd) AS total
         FROM venta v JOIN cliente c ON c.id = v.cliente_id
        WHERE v.estado = 'EMITIDA'
        GROUP BY c.nombre ORDER BY total DESC LIMIT 5`,
    );
    const lista = filas.map((f: any, i: number) => `${i + 1}. ${f.nombre}: ${money(Number(f.total))} en ${f.facturas} factura(s)`).join('\n');
    return {
      intencion: 'mejores_clientes',
      motor: 'local',
      datos: filas,
      respuesta: filas.length ? `Tus mejores clientes:\n${lista}` : 'Aun no hay ventas asociadas a clientes registrados.',
    };
  }

  if (contiene(t, 'inventario', 'existencia', 'almacen', 'cuanto tengo')) {
    const r = await resumen();
    return {
      intencion: 'inventario',
      motor: 'local',
      datos: r.inventario,
      respuesta:
        `Tu inventario vale ${money(r.inventario.valor_usd)} al costo, con ${r.inventario.unidades} unidades ` +
        `en ${r.inventario.referencias} referencia(s). Hay ${r.inventario.alertas_stock_bajo} alerta(s) de stock bajo.`,
    };
  }

  if (contiene(t, 'utilidad', 'ganancia', 'margen', 'gane', 'rentabilidad')) {
    const r = await resumen();
    return {
      intencion: 'utilidad',
      motor: 'local',
      datos: r.mes,
      respuesta:
        `Este mes vendiste ${money(r.mes.ventas_usd)} con un costo de ${money(r.mes.costo_usd)}, ` +
        `lo que deja una utilidad bruta de ${money(r.mes.utilidad_usd)} (margen ${r.mes.margen_pct.toFixed(1)}%).`,
    };
  }

  if (contiene(t, 'hoy', 'del dia', 'vendi hoy')) {
    const r = await resumen();
    return {
      intencion: 'ventas_hoy',
      motor: 'local',
      datos: r.hoy,
      respuesta:
        `Hoy llevas ${r.hoy.facturas} factura(s) por ${money(r.hoy.ventas_usd)} ` +
        `(${r.hoy.ventas_bs.toFixed(2)} Bs), con un ticket promedio de ${money(r.hoy.ticket_promedio_usd)}.`,
    };
  }

  if (contiene(t, 'venta', 'vendi', 'facturacion', 'ingreso', 'mes')) {
    const r = await resumen();
    return {
      intencion: 'ventas_mes',
      motor: 'local',
      datos: r.mes,
      respuesta:
        `Este mes acumulas ${money(r.mes.ventas_usd)} en ${r.mes.facturas} factura(s). ` +
        `IVA generado: ${money(r.mes.iva_usd)}. Compras del mes: ${money(r.mes.compras_usd)}.`,
    };
  }

  // Busqueda de un producto por nombre: "precio de X", "cuanto queda de X"
  const palabras = t
    .replace(/[?¿!¡.,;:]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !PALABRAS_VACIAS.has(w));

  if (palabras.length > 0) {
    const patrones = palabras.map((w) => `%${w}%`);
    const filas = await consultar<any>(
      `SELECT p.nombre, p.sku, p.precio_usd, p.costo_usd, COALESCE(SUM(e.cantidad),0) AS existencia
         FROM producto p LEFT JOIN existencia e ON e.producto_id = p.id
        WHERE p.activo AND (p.nombre ILIKE ANY($1::text[]) OR p.sku ILIKE ANY($1::text[]))
        GROUP BY p.id, p.nombre, p.sku, p.precio_usd, p.costo_usd
        ORDER BY p.nombre LIMIT 5`,
      [patrones],
    );
    if (filas.length > 0) {
      const tasa = await tasaVigente();
      const lista = filas
        .map(
          (f: any) =>
            `- ${f.nombre} (${f.sku}): ${money(Number(f.precio_usd))} / ${usdABolivares(Number(f.precio_usd), tasa.valor).toFixed(2)} Bs · existencia ${Number(f.existencia)}`,
        )
        .join('\n');
      return { intencion: 'producto', motor: 'local', datos: filas, respuesta: `Encontre esto:\n${lista}` };
    }
  }

  const r = await resumen();
  return {
    intencion: 'desconocida',
    motor: 'local',
    datos: r,
    respuesta:
      'No entendi esa pregunta. Puedo responder sobre: ventas de hoy o del mes, utilidad y margen, ' +
      'stock bajo, cuentas por cobrar y por pagar, productos mas vendidos, mejores clientes, ' +
      'valor del inventario, tasa del dia y precio o existencia de un producto.',
  };
}

/**
 * Modo opcional: delega la redaccion a Claude, pasandole un resumen compacto
 * del negocio. Nunca se envian datos personales de clientes.
 */
async function responderConAnthropic(pregunta: string): Promise<RespuestaAsistente> {
  const base = await responderLocal(pregunta);
  const panel = await resumen();
  const alertas = await stockBajo(10);
  const top = await topProductos(5);

  const contexto = JSON.stringify({ panel, alertas, top_productos: top, dato_relevante: base.datos }, null, 0);

  const respuesta = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.anthropicApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: env.anthropicModel,
      max_tokens: 700,
      system:
        'Eres el asistente administrativo de una PyME venezolana. Respondes en espanol, en tono directo y breve. ' +
        'Usas unicamente los datos del contexto; si un dato no esta, lo dices. Los montos van en USD y, cuando ayude, ' +
        'su equivalente en bolivares a la tasa del contexto.',
      messages: [{ role: 'user', content: `Datos del negocio (JSON):\n${contexto}\n\nPregunta: ${pregunta}` }],
    }),
  });

  if (!respuesta.ok) {
    const detalle = await respuesta.text();
    console.warn('[asistente] Anthropic fallo, uso motor local:', respuesta.status, detalle.slice(0, 200));
    return base;
  }

  const cuerpo = (await respuesta.json()) as { content?: Array<{ type: string; text?: string }> };
  const texto = (cuerpo.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n').trim();
  if (!texto) return base;

  return { respuesta: texto, intencion: base.intencion, datos: base.datos, motor: 'anthropic' };
}

export async function preguntar(pregunta: string): Promise<RespuestaAsistente> {
  if (env.asistenteModo === 'anthropic' && env.anthropicApiKey) {
    try {
      return await responderConAnthropic(pregunta);
    } catch (error) {
      console.warn('[asistente] error con Anthropic, uso motor local:', (error as Error).message);
    }
  }
  return responderLocal(pregunta);
}

export async function sugerencias(): Promise<string[]> {
  const hayVentas = await uno<{ n: number }>(`SELECT COUNT(*)::int AS n FROM venta WHERE estado='EMITIDA'`);
  const base = [
    '¿Cuanto vendi hoy?',
    '¿Que productos estan por agotarse?',
    '¿Cuanto me deben los clientes?',
    '¿Cual es mi utilidad de este mes?',
    '¿Cual es la tasa del dia?',
  ];
  if ((hayVentas?.n ?? 0) > 0) base.splice(2, 0, '¿Cual es mi producto mas vendido?');
  return base;
}
