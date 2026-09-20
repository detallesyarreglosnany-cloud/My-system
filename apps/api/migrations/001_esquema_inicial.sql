-- =============================================================================
--  Fina Local · esquema inicial
--  Moneda base: USD. Cada documento guarda la tasa Bs/USD del dia para poder
--  reconstruir los montos en bolivares exigidos por el SENIAT.
-- =============================================================================

CREATE TABLE organizacion (
  id                SERIAL PRIMARY KEY,
  nombre            TEXT        NOT NULL,
  rif               TEXT        NOT NULL,
  direccion         TEXT        NOT NULL DEFAULT '',
  telefono          TEXT        NOT NULL DEFAULT '',
  email             TEXT        NOT NULL DEFAULT '',
  moneda_base       TEXT        NOT NULL DEFAULT 'USD',
  iva_tasa          NUMERIC(6,3) NOT NULL DEFAULT 16,
  igtf_tasa         NUMERIC(6,3) NOT NULL DEFAULT 3,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sucursal (
  id                SERIAL PRIMARY KEY,
  codigo            TEXT        NOT NULL UNIQUE,
  nombre            TEXT        NOT NULL,
  direccion         TEXT        NOT NULL DEFAULT '',
  es_principal      BOOLEAN     NOT NULL DEFAULT false,
  activa            BOOLEAN     NOT NULL DEFAULT true,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE usuario (
  id                SERIAL PRIMARY KEY,
  email             TEXT        NOT NULL UNIQUE,
  nombre            TEXT        NOT NULL,
  password_hash     TEXT        NOT NULL,
  rol               TEXT        NOT NULL CHECK (rol IN ('PROPIETARIO','ADMIN','VENDEDOR','ALMACEN','CONTADOR')),
  sucursal_id       INTEGER     REFERENCES sucursal(id) ON DELETE SET NULL,
  activo            BOOLEAN     NOT NULL DEFAULT true,
  ultimo_acceso     TIMESTAMPTZ,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE categoria (
  id                SERIAL PRIMARY KEY,
  nombre            TEXT        NOT NULL UNIQUE,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE producto (
  id                SERIAL PRIMARY KEY,
  sku               TEXT        NOT NULL UNIQUE,
  codigo_barras     TEXT        UNIQUE,
  nombre            TEXT        NOT NULL,
  descripcion       TEXT        NOT NULL DEFAULT '',
  categoria_id      INTEGER     REFERENCES categoria(id) ON DELETE SET NULL,
  tipo              TEXT        NOT NULL DEFAULT 'BIEN' CHECK (tipo IN ('BIEN','SERVICIO')),
  unidad            TEXT        NOT NULL DEFAULT 'UND',
  precio_usd        NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (precio_usd >= 0),
  costo_usd         NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (costo_usd >= 0),
  iva_tasa          NUMERIC(6,3)  NOT NULL DEFAULT 16 CHECK (iva_tasa >= 0),
  stock_minimo      NUMERIC(18,4) NOT NULL DEFAULT 0,
  activo            BOOLEAN     NOT NULL DEFAULT true,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_producto_nombre ON producto (lower(nombre));
CREATE INDEX idx_producto_categoria ON producto (categoria_id);

-- Stock por producto y sucursal (los SERVICIO no llevan existencia).
CREATE TABLE existencia (
  producto_id       INTEGER NOT NULL REFERENCES producto(id) ON DELETE CASCADE,
  sucursal_id       INTEGER NOT NULL REFERENCES sucursal(id) ON DELETE CASCADE,
  cantidad          NUMERIC(18,4) NOT NULL DEFAULT 0,
  PRIMARY KEY (producto_id, sucursal_id)
);

CREATE TABLE movimiento_inventario (
  id                BIGSERIAL PRIMARY KEY,
  producto_id       INTEGER NOT NULL REFERENCES producto(id) ON DELETE CASCADE,
  sucursal_id       INTEGER NOT NULL REFERENCES sucursal(id) ON DELETE CASCADE,
  tipo              TEXT    NOT NULL CHECK (tipo IN ('ENTRADA','SALIDA','AJUSTE','TRANSFERENCIA')),
  cantidad          NUMERIC(18,4) NOT NULL,          -- con signo: + entra, - sale
  saldo_resultante  NUMERIC(18,4) NOT NULL,
  costo_unitario_usd NUMERIC(18,4) NOT NULL DEFAULT 0,
  referencia_tipo   TEXT,                             -- VENTA | COMPRA | AJUSTE | TRANSFERENCIA
  referencia_id     BIGINT,
  nota              TEXT NOT NULL DEFAULT '',
  usuario_id        INTEGER REFERENCES usuario(id) ON DELETE SET NULL,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_movimiento_producto ON movimiento_inventario (producto_id, creado_en DESC);
CREATE INDEX idx_movimiento_referencia ON movimiento_inventario (referencia_tipo, referencia_id);

CREATE TABLE cliente (
  id                SERIAL PRIMARY KEY,
  tipo_documento    TEXT NOT NULL DEFAULT 'V' CHECK (tipo_documento IN ('V','E','J','G','P')),
  documento         TEXT NOT NULL,
  nombre            TEXT NOT NULL,
  email             TEXT NOT NULL DEFAULT '',
  telefono          TEXT NOT NULL DEFAULT '',
  direccion         TEXT NOT NULL DEFAULT '',
  limite_credito_usd NUMERIC(18,4) NOT NULL DEFAULT 0,
  dias_credito      INTEGER NOT NULL DEFAULT 0,
  activo            BOOLEAN NOT NULL DEFAULT true,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tipo_documento, documento)
);
CREATE INDEX idx_cliente_nombre ON cliente (lower(nombre));

CREATE TABLE proveedor (
  id                SERIAL PRIMARY KEY,
  tipo_documento    TEXT NOT NULL DEFAULT 'J' CHECK (tipo_documento IN ('V','E','J','G','P')),
  documento         TEXT NOT NULL,
  nombre            TEXT NOT NULL,
  email             TEXT NOT NULL DEFAULT '',
  telefono          TEXT NOT NULL DEFAULT '',
  direccion         TEXT NOT NULL DEFAULT '',
  activo            BOOLEAN NOT NULL DEFAULT true,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tipo_documento, documento)
);

-- Tasa Bs/USD del dia. Una fila por fecha.
CREATE TABLE tasa_cambio (
  fecha             DATE PRIMARY KEY,
  valor             NUMERIC(18,6) NOT NULL CHECK (valor > 0),
  fuente            TEXT NOT NULL DEFAULT 'MANUAL',
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE metodo_pago (
  codigo            TEXT PRIMARY KEY,
  nombre            TEXT NOT NULL,
  moneda            TEXT NOT NULL CHECK (moneda IN ('USD','VES')),
  aplica_igtf       BOOLEAN NOT NULL DEFAULT false,
  activo            BOOLEAN NOT NULL DEFAULT true,
  orden             INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE correlativo (
  tipo              TEXT PRIMARY KEY,
  prefijo           TEXT NOT NULL DEFAULT '',
  siguiente         BIGINT NOT NULL DEFAULT 1
);

-- ── Ventas ──────────────────────────────────────────────────────────────────
CREATE TABLE venta (
  id                BIGSERIAL PRIMARY KEY,
  numero            TEXT NOT NULL UNIQUE,
  sucursal_id       INTEGER NOT NULL REFERENCES sucursal(id),
  cliente_id        INTEGER REFERENCES cliente(id) ON DELETE SET NULL,
  usuario_id        INTEGER REFERENCES usuario(id) ON DELETE SET NULL,
  fecha             TIMESTAMPTZ NOT NULL DEFAULT now(),
  condicion         TEXT NOT NULL DEFAULT 'CONTADO' CHECK (condicion IN ('CONTADO','CREDITO')),
  estado            TEXT NOT NULL DEFAULT 'EMITIDA' CHECK (estado IN ('EMITIDA','ANULADA')),
  tasa              NUMERIC(18,6) NOT NULL,
  subtotal_usd      NUMERIC(18,4) NOT NULL DEFAULT 0,
  descuento_usd     NUMERIC(18,4) NOT NULL DEFAULT 0,
  base_imponible_usd NUMERIC(18,4) NOT NULL DEFAULT 0,
  iva_usd           NUMERIC(18,4) NOT NULL DEFAULT 0,
  igtf_usd          NUMERIC(18,4) NOT NULL DEFAULT 0,
  total_usd         NUMERIC(18,4) NOT NULL DEFAULT 0,
  costo_usd         NUMERIC(18,4) NOT NULL DEFAULT 0,
  pagado_usd        NUMERIC(18,4) NOT NULL DEFAULT 0,
  saldo_usd         NUMERIC(18,4) NOT NULL DEFAULT 0,
  dias_credito      INTEGER NOT NULL DEFAULT 0,
  vence_el          DATE,
  nota              TEXT NOT NULL DEFAULT '',
  anulada_en        TIMESTAMPTZ,
  anulada_motivo    TEXT,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_venta_fecha ON venta (fecha DESC);
CREATE INDEX idx_venta_cliente ON venta (cliente_id);
CREATE INDEX idx_venta_estado_saldo ON venta (estado, saldo_usd);

CREATE TABLE venta_linea (
  id                BIGSERIAL PRIMARY KEY,
  venta_id          BIGINT NOT NULL REFERENCES venta(id) ON DELETE CASCADE,
  producto_id       INTEGER REFERENCES producto(id) ON DELETE SET NULL,
  descripcion       TEXT NOT NULL,
  cantidad          NUMERIC(18,4) NOT NULL CHECK (cantidad > 0),
  precio_usd        NUMERIC(18,4) NOT NULL CHECK (precio_usd >= 0),
  descuento_usd     NUMERIC(18,4) NOT NULL DEFAULT 0,
  iva_tasa          NUMERIC(6,3) NOT NULL DEFAULT 0,
  iva_usd           NUMERIC(18,4) NOT NULL DEFAULT 0,
  total_usd         NUMERIC(18,4) NOT NULL DEFAULT 0,
  costo_unitario_usd NUMERIC(18,4) NOT NULL DEFAULT 0
);
CREATE INDEX idx_venta_linea_venta ON venta_linea (venta_id);
CREATE INDEX idx_venta_linea_producto ON venta_linea (producto_id);

-- ── Compras ─────────────────────────────────────────────────────────────────
CREATE TABLE compra (
  id                BIGSERIAL PRIMARY KEY,
  numero            TEXT NOT NULL UNIQUE,
  documento_proveedor TEXT NOT NULL DEFAULT '',
  proveedor_id      INTEGER REFERENCES proveedor(id) ON DELETE SET NULL,
  sucursal_id       INTEGER NOT NULL REFERENCES sucursal(id),
  usuario_id        INTEGER REFERENCES usuario(id) ON DELETE SET NULL,
  fecha             TIMESTAMPTZ NOT NULL DEFAULT now(),
  condicion         TEXT NOT NULL DEFAULT 'CONTADO' CHECK (condicion IN ('CONTADO','CREDITO')),
  estado            TEXT NOT NULL DEFAULT 'EMITIDA' CHECK (estado IN ('EMITIDA','ANULADA')),
  tasa              NUMERIC(18,6) NOT NULL,
  subtotal_usd      NUMERIC(18,4) NOT NULL DEFAULT 0,
  iva_usd           NUMERIC(18,4) NOT NULL DEFAULT 0,
  total_usd         NUMERIC(18,4) NOT NULL DEFAULT 0,
  pagado_usd        NUMERIC(18,4) NOT NULL DEFAULT 0,
  saldo_usd         NUMERIC(18,4) NOT NULL DEFAULT 0,
  dias_credito      INTEGER NOT NULL DEFAULT 0,
  vence_el          DATE,
  nota              TEXT NOT NULL DEFAULT '',
  anulada_en        TIMESTAMPTZ,
  anulada_motivo    TEXT,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_compra_fecha ON compra (fecha DESC);
CREATE INDEX idx_compra_estado_saldo ON compra (estado, saldo_usd);

CREATE TABLE compra_linea (
  id                BIGSERIAL PRIMARY KEY,
  compra_id         BIGINT NOT NULL REFERENCES compra(id) ON DELETE CASCADE,
  producto_id       INTEGER REFERENCES producto(id) ON DELETE SET NULL,
  descripcion       TEXT NOT NULL,
  cantidad          NUMERIC(18,4) NOT NULL CHECK (cantidad > 0),
  costo_usd         NUMERIC(18,4) NOT NULL CHECK (costo_usd >= 0),
  iva_tasa          NUMERIC(6,3) NOT NULL DEFAULT 0,
  iva_usd           NUMERIC(18,4) NOT NULL DEFAULT 0,
  total_usd         NUMERIC(18,4) NOT NULL DEFAULT 0
);
CREATE INDEX idx_compra_linea_compra ON compra_linea (compra_id);

-- ── Pagos (cobros a clientes y pagos a proveedores) ─────────────────────────
CREATE TABLE pago (
  id                BIGSERIAL PRIMARY KEY,
  tipo              TEXT NOT NULL CHECK (tipo IN ('COBRO','PAGO')),
  venta_id          BIGINT REFERENCES venta(id) ON DELETE CASCADE,
  compra_id         BIGINT REFERENCES compra(id) ON DELETE CASCADE,
  metodo            TEXT NOT NULL REFERENCES metodo_pago(codigo),
  moneda            TEXT NOT NULL CHECK (moneda IN ('USD','VES')),
  tasa              NUMERIC(18,6) NOT NULL,
  monto_usd         NUMERIC(18,4) NOT NULL CHECK (monto_usd > 0),
  monto_bs          NUMERIC(18,2) NOT NULL DEFAULT 0,
  igtf_usd          NUMERIC(18,4) NOT NULL DEFAULT 0,
  referencia        TEXT NOT NULL DEFAULT '',
  fecha             TIMESTAMPTZ NOT NULL DEFAULT now(),
  usuario_id        INTEGER REFERENCES usuario(id) ON DELETE SET NULL,
  CONSTRAINT pago_documento_unico CHECK (
    (venta_id IS NOT NULL AND compra_id IS NULL) OR
    (venta_id IS NULL AND compra_id IS NOT NULL)
  )
);
CREATE INDEX idx_pago_venta ON pago (venta_id);
CREATE INDEX idx_pago_compra ON pago (compra_id);
CREATE INDEX idx_pago_fecha ON pago (fecha DESC);

CREATE TABLE auditoria (
  id                BIGSERIAL PRIMARY KEY,
  usuario_id        INTEGER REFERENCES usuario(id) ON DELETE SET NULL,
  accion            TEXT NOT NULL,
  entidad           TEXT NOT NULL,
  entidad_id        TEXT,
  datos             JSONB NOT NULL DEFAULT '{}'::jsonb,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_auditoria_fecha ON auditoria (creado_en DESC);

-- ── Catalogos base ──────────────────────────────────────────────────────────
INSERT INTO metodo_pago (codigo, nombre, moneda, aplica_igtf, orden) VALUES
  ('EFECTIVO_USD',   'Efectivo USD',        'USD', true,  10),
  ('ZELLE',          'Zelle',               'USD', true,  20),
  ('USDT',           'USDT / Binance',      'USD', true,  30),
  ('EFECTIVO_BS',    'Efectivo Bs',         'VES', false, 40),
  ('PAGO_MOVIL',     'Pago movil',          'VES', false, 50),
  ('TRANSFERENCIA',  'Transferencia Bs',    'VES', false, 60),
  ('PUNTO_VENTA',    'Punto de venta',      'VES', false, 70);

INSERT INTO correlativo (tipo, prefijo, siguiente) VALUES
  ('VENTA',  'F-', 1),
  ('COMPRA', 'C-', 1);
