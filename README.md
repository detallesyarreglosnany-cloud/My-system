# Fina Local

Sistema administrativo autoalojado para PyMEs venezolanas: ventas, inventario
multi-almacén, cuentas por cobrar y pagar, compras, reportes fiscales y un
asistente que responde sobre tus datos. Maneja bolívares y dólares a la tasa del
día, con IVA e IGTF calculados como manda la norma.

Todo corre en tu propio servidor. Los datos no salen de ahí.

---

## Arrancar en tu nube

Necesitas una máquina con Docker y el plugin `compose`. Nada más.

```bash
git clone <tu-repositorio> fina-local
cd fina-local

cp .env.example .env
# Genera dos secretos y pégalos en .env
openssl rand -hex 32   # -> POSTGRES_PASSWORD
openssl rand -hex 48   # -> JWT_SECRET

docker compose up -d --build
docker compose run --rm app npm run seed:prod
```

Abre `http://tu-servidor:8080` y entra con el correo y la clave que pusiste en
`ADMIN_EMAIL` y `ADMIN_PASSWORD`.

El seed crea la organización, el usuario propietario, dos sucursales, un
catálogo de ejemplo y unas 180 ventas repartidas en los últimos 45 días, para
que el panel tenga algo que mostrar desde el primer minuto. Para empezar en
limpio:

```bash
docker compose run --rm app npm run seed:prod -- --sin-demo
```

### Antes de usarlo de verdad

1. Cambia `ADMIN_PASSWORD` desde **Configuración → Cambiar mi clave**.
2. Pon los datos reales de tu empresa en **Configuración → Datos de la empresa**.
3. Carga la tasa del día en **Configuración → Tasa de cambio**.
4. Pon el sistema detrás de HTTPS. Cualquier proxy inverso sirve; apunta al
   puerto `8080` del host.
5. Programa el respaldo: `./deploy/respaldo.sh` en un cron diario.

---

## Comandos

```bash
make arrancar    # levanta todo con Docker
make semilla     # carga datos iniciales
make registro    # logs en vivo
make respaldo    # respaldo comprimido de la base
make pruebas     # batería de pruebas de la API
make detener     # apaga los contenedores
```

---

## Desarrollo

Requiere Node 20 o superior y un PostgreSQL accesible.

```bash
npm install
cp .env.example .env          # apunta DATABASE_URL a tu Postgres local
npm run migrate
npm run seed
npm run dev                   # API en :4000, frontend en :5173
```

Pruebas:

```bash
DATABASE_URL=postgres://usuario@localhost:5432/fina_test npm test
```

La suite usa una base aparte y la limpia al empezar. **No la apuntes a tu base
de producción.**

---

## Qué trae

**Punto de venta.** Catálogo con búsqueda, carrito, descuentos por línea y
globales, cotización en vivo contra el servidor, pagos mixtos en varias monedas
y comprobante al cerrar. El stock baja en el momento.

**Inventario.** Existencias por sucursal, ajustes con motivo, transferencias
entre almacenes, kardex por producto y alertas cuando algo baja del mínimo. El
costo promedio ponderado se recalcula en cada compra.

**Cuentas.** Antigüedad de saldos por tramos (por vencer, 1–30, 31–60, +60) para
clientes y proveedores, con abonos parciales y control de límite de crédito.

**Reportes.** Libro de ventas en bolívares a la tasa de cada documento, listo
para el SENIAT y exportable a CSV. Rentabilidad por producto, desglose de formas
de cobro y valorización de inventario.

**Asistente.** Pregúntale en español por ventas, utilidad, deudas, precios o
existencias. Por defecto resuelve todo dentro del servidor.

---

## Configuración

Todo se controla por variables de entorno en `.env`. Las que importan:

| Variable | Para qué |
|---|---|
| `POSTGRES_PASSWORD` | Clave de la base. Obligatoria. |
| `JWT_SECRET` | Firma de sesiones. Mínimo 32 caracteres; el arranque falla si es más corta. |
| `WEB_PORT` | Puerto del host donde queda la app. Por defecto `8080`. |
| `IVA_TASA` / `IGTF_TASA` | Alícuotas por defecto. `16` y `3`. |
| `TASA_INICIAL` | Tasa Bs/USD con la que arranca el sistema. |
| `TASA_FUENTE` | `manual` (sin salida a internet) o `http` para consultar `TASA_FUENTE_URL` a diario. |
| `ASISTENTE_MODO` | `local` o `anthropic`. |
| `DATABASE_SSL` | `disable`, `require` o `no-verify`. Usa `no-verify` con bases gestionadas como Supabase o Neon. |
| `DB_POOL_MAX` | Conexiones del pool. Bájalo a `3` en despliegues serverless. |
| `SEED_DIAS` | Días de historia que genera el seed de ejemplo. |
| `ANTHROPIC_API_KEY` | Solo si usas el modo `anthropic`. |

---

## Roles

| Rol | Puede |
|---|---|
| `PROPIETARIO` / `ADMIN` | Todo, incluido anular documentos y gestionar usuarios |
| `VENDEDOR` | Facturar, cobrar, crear clientes |
| `ALMACEN` | Productos, compras, ajustes y transferencias |
| `CONTADOR` | Cobros, pagos y carga de la tasa |

---

## Estructura

```
apps/api/            API en Node + TypeScript
  migrations/        esquema SQL versionado
  src/lib/           conexión, dinero, auth, errores
  src/modules/       dominio: ventas, compras, inventario, tasa, reportes, asistente
  src/rutas/         endpoints HTTP con validación Zod
  src/pruebas/       pruebas de integración
apps/web/            SPA en React + TypeScript
  src/paginas/       una por sección del sistema
  src/componentes/   primitivas de interfaz
deploy/              script de respaldo
docs/ARQUITECTURA.md investigación del producto original y decisiones de diseño
```

---

## Respaldos

```bash
./deploy/respaldo.sh
```

Deja un `.sql.gz` en `deploy/respaldos/` y conserva los últimos 30. Para
restaurar:

```bash
gunzip -c deploy/respaldos/fina-AAAAMMDD-HHMMSS.sql.gz \
  | docker compose exec -T db psql -U fina -d fina
```

---

## Desplegar en Vercel

El repositorio trae `vercel.json` y `api/index.mjs`, que exponen la misma API
Express como función serverless mientras Vercel sirve el SPA desde su CDN.
Necesitas una base PostgreSQL alcanzable, por ejemplo Supabase, y estas
variables en el proyecto de Vercel:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | Cadena del *pooler* en modo transacción de tu proveedor |
| `DATABASE_SSL` | `no-verify` |
| `DB_POOL_MAX` | `3` |
| `JWT_SECRET` | 64 caracteres aleatorios |
| `SEED_DIAS` | `20`, para que el build no tarde |

El comando de build (`npm run vercel-build`) compila la API, aplica las
migraciones, carga el seed si la base está vacía y compila el frontend.

Ten presente que un despliegue en Vercel deja la aplicación en internet. Para
tus datos reales, usa el despliegue con Docker descrito arriba.

---

## Nota

Este es un sistema independiente, escrito desde cero, inspirado en las
capacidades que **finapartner.com** describe públicamente. No comparte código ni
datos con ese producto, ni está afiliado a él. El análisis del original y las
decisiones de diseño están en [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md).
