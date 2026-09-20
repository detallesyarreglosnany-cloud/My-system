import 'dotenv/config';

function leer(clave: string, porDefecto?: string): string {
  const valor = process.env[clave];
  if (valor === undefined || valor === '') {
    if (porDefecto !== undefined) return porDefecto;
    throw new Error(`Falta la variable de entorno ${clave}`);
  }
  return valor;
}

function leerNumero(clave: string, porDefecto: number): number {
  const valor = process.env[clave];
  if (valor === undefined || valor === '') return porDefecto;
  const n = Number(valor);
  if (!Number.isFinite(n)) throw new Error(`La variable ${clave} debe ser numerica`);
  return n;
}

const esProduccion = process.env.NODE_ENV === 'production';

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  esProduccion,
  puerto: leerNumero('PORT', 4000),
  databaseUrl: leer('DATABASE_URL', 'postgres://postgres@127.0.0.1:5432/fina'),
  jwtSecret: (() => {
    const s = process.env.JWT_SECRET ?? '';
    if (esProduccion && s.length < 32) {
      throw new Error('JWT_SECRET debe tener al menos 32 caracteres en produccion');
    }
    return s || 'secreto-de-desarrollo-no-usar-en-produccion';
  })(),
  jwtExpiraEn: leer('JWT_EXPIRES_IN', '12h'),
  corsOrigin: leer('CORS_ORIGIN', '*'),
  ivaTasa: leerNumero('IVA_TASA', 16),
  igtfTasa: leerNumero('IGTF_TASA', 3),
  tasaFuente: leer('TASA_FUENTE', 'manual') as 'manual' | 'http',
  tasaFuenteUrl: process.env.TASA_FUENTE_URL ?? '',
  tasaInicial: leerNumero('TASA_INICIAL', 36.5),
  asistenteModo: leer('ASISTENTE_MODO', 'local') as 'local' | 'anthropic',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  anthropicModel: leer('ANTHROPIC_MODEL', 'claude-sonnet-5'),
  org: {
    nombre: leer('ORG_NOMBRE', 'Mi Negocio, C.A.'),
    rif: leer('ORG_RIF', 'J-000000000'),
    monedaBase: leer('ORG_MONEDA_BASE', 'USD'),
  },
  admin: {
    email: leer('ADMIN_EMAIL', 'admin@minegocio.com'),
    password: leer('ADMIN_PASSWORD', 'Admin.12345'),
    nombre: leer('ADMIN_NOMBRE', 'Administrador'),
  },
};
