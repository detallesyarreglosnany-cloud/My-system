import type pg from 'pg';
import { consultar, pool, uno, type Consultable } from '../lib/db.js';
import { env } from '../lib/env.js';
import { redondear } from '../lib/dinero.js';
import { solicitudInvalida } from '../lib/errores.js';

export interface Tasa {
  fecha: string;
  valor: number;
  fuente: string;
}

function hoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Tasa Bs/USD vigente para una fecha: la ultima cargada con fecha <= la pedida.
 * Si la base aun no tiene ninguna, cae a TASA_INICIAL para que el sistema
 * arranque sin bloquear la primera venta.
 */
export async function tasaVigente(fecha = hoyIso(), cliente: Consultable = pool): Promise<Tasa> {
  const fila = await uno<{ fecha: Date; valor: number; fuente: string }>(
    `SELECT fecha, valor, fuente FROM tasa_cambio WHERE fecha <= $1 ORDER BY fecha DESC LIMIT 1`,
    [fecha],
    cliente,
  );
  if (!fila) return { fecha, valor: env.tasaInicial, fuente: 'POR_DEFECTO' };
  return {
    fecha: fila.fecha.toISOString().slice(0, 10),
    valor: Number(fila.valor),
    fuente: fila.fuente,
  };
}

export async function guardarTasa(fecha: string, valor: number, fuente = 'MANUAL'): Promise<Tasa> {
  if (!(valor > 0)) throw solicitudInvalida('La tasa debe ser mayor que cero');
  const fila = await uno<{ fecha: Date; valor: number; fuente: string }>(
    `INSERT INTO tasa_cambio (fecha, valor, fuente) VALUES ($1, $2, $3)
       ON CONFLICT (fecha) DO UPDATE SET valor = EXCLUDED.valor, fuente = EXCLUDED.fuente
     RETURNING fecha, valor, fuente`,
    [fecha, redondear(valor, 6), fuente],
  );
  return { fecha: fila!.fecha.toISOString().slice(0, 10), valor: Number(fila!.valor), fuente: fila!.fuente };
}

export async function historicoTasas(limite = 60): Promise<Tasa[]> {
  const filas = await consultar<{ fecha: Date; valor: number; fuente: string }>(
    `SELECT fecha, valor, fuente FROM tasa_cambio ORDER BY fecha DESC LIMIT $1`,
    [limite],
  );
  return filas.map((f) => ({ fecha: f.fecha.toISOString().slice(0, 10), valor: Number(f.valor), fuente: f.fuente }));
}

/**
 * Sincroniza la tasa del dia desde TASA_FUENTE_URL (JSON). Se acepta cualquier
 * respuesta que traiga un numero en alguna de las claves conocidas. Queda
 * desactivado por defecto: en modo `manual` el sistema no sale a internet.
 */
export async function sincronizarTasa(): Promise<Tasa | null> {
  if (env.tasaFuente !== 'http' || !env.tasaFuenteUrl) return null;
  const control = new AbortController();
  const corte = setTimeout(() => control.abort(), 10_000);
  try {
    const respuesta = await fetch(env.tasaFuenteUrl, { signal: control.signal });
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
    const cuerpo: unknown = await respuesta.json();
    const valor = extraerValor(cuerpo);
    if (valor === null) throw new Error('No se encontro un valor numerico en la respuesta');
    return await guardarTasa(hoyIso(), valor, 'HTTP');
  } catch (error) {
    console.warn('[tasa] no se pudo sincronizar:', (error as Error).message);
    return null;
  } finally {
    clearTimeout(corte);
  }
}

const CLAVES_TASA = ['promedio', 'valor', 'price', 'rate', 'usd', 'dolar', 'monitor', 'bcv'];

function extraerValor(cuerpo: unknown): number | null {
  if (typeof cuerpo === 'number' && cuerpo > 0) return cuerpo;
  if (!cuerpo || typeof cuerpo !== 'object') return null;
  const objeto = cuerpo as Record<string, unknown>;
  for (const clave of CLAVES_TASA) {
    const v = objeto[clave];
    if (typeof v === 'number' && v > 0) return v;
    if (typeof v === 'string' && Number(v) > 0) return Number(v);
    if (v && typeof v === 'object') {
      const anidado = extraerValor(v);
      if (anidado !== null) return anidado;
    }
  }
  return null;
}

/** Programa la sincronizacion diaria cuando TASA_FUENTE=http. */
export function programarSincronizacionDiaria(): NodeJS.Timeout | null {
  if (env.tasaFuente !== 'http' || !env.tasaFuenteUrl) return null;
  void sincronizarTasa();
  return setInterval(() => void sincronizarTasa(), 6 * 60 * 60 * 1000).unref();
}

export type ClientePg = pg.PoolClient;
