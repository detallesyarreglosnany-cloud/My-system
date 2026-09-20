/**
 * Utilidades monetarias.
 *
 * Todo el dominio trabaja en USD con 2 decimales. Para evitar el clasico
 * 0.1 + 0.2 = 0.30000000000000004 se redondea en cada operacion que produce un
 * monto persistible, usando redondeo "half away from zero" (el que espera un
 * contador, no el "half to even" de toFixed en algunos motores).
 */

export function redondear(valor: number, decimales = 2): number {
  if (!Number.isFinite(valor)) return 0;
  const factor = 10 ** decimales;
  // toPrecision(15) limpia el ruido binario (1.005*100 -> 100.49999999999999)
  // antes de redondear, de modo que .5 siempre sube en valor absoluto.
  const escalado = Number((valor * factor).toPrecision(15));
  const redondeado = escalado < 0 ? -Math.round(-escalado) : Math.round(escalado);
  return redondeado / factor;
}

/** Redondeo a 2 decimales, el formato de todo monto en USD. */
export const usd = (valor: number) => redondear(valor, 2);

/** Redondeo a 2 decimales para bolivares. */
export const bs = (valor: number) => redondear(valor, 2);

/** Cantidades de inventario: 4 decimales para soportar peso/volumen. */
export const cantidad = (valor: number) => redondear(valor, 4);

export function usdABolivares(montoUsd: number, tasa: number): number {
  return bs(montoUsd * tasa);
}

export function bolivaresAUsd(montoBs: number, tasa: number): number {
  if (tasa <= 0) return 0;
  return usd(montoBs / tasa);
}

/** Porcentaje sobre una base, ej. porcentaje(100, 16) === 16. */
export function porcentaje(base: number, tasa: number): number {
  return usd((base * tasa) / 100);
}
