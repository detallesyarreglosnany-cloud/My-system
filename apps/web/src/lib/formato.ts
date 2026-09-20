const usdFmt = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const bsFmt = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const enteroFmt = new Intl.NumberFormat('es-VE', { maximumFractionDigits: 2 });

export const n = (valor: unknown): number => {
  const v = Number(valor);
  return Number.isFinite(v) ? v : 0;
};

export const usd = (valor: unknown) => `$${usdFmt.format(n(valor))}`;
export const bs = (valor: unknown) => `Bs ${bsFmt.format(n(valor))}`;
export const numero = (valor: unknown) => enteroFmt.format(n(valor));
export const porcentaje = (valor: unknown) => `${enteroFmt.format(n(valor))}%`;

export function fecha(valor: unknown): string {
  if (!valor) return '—';
  const d = new Date(String(valor));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function fechaHora(valor: unknown): string {
  if (!valor) return '—';
  const d = new Date(String(valor));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-VE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export const hoyIso = () => new Date().toISOString().slice(0, 10);

export function primerDiaDelMes(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export function diasDesde(valor: unknown): number | null {
  if (!valor) return null;
  const d = new Date(String(valor));
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}
