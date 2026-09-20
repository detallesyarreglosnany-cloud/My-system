# Arquitectura de Fina y diseño del clon privado

Este documento explica dos cosas: qué es y cómo está organizado **finapartner.com**,
y cómo se reconstruyó ese producto en una versión privada y autoalojada.

---

## 1. Qué es Fina

Fina (finapartner.com) es un **sistema administrativo en la nube para PyMEs
venezolanas**. Se opera desde el navegador en PC, tablet o teléfono, sin
instalaciones, y concentra en una sola plataforma ventas, inventario, cuentas y
reportes. Se distribuye como SaaS de plan único (alrededor de 35 USD + IVA al
mes, con descuento trimestral), sin contrato, y reporta más de 5.000 negocios
activos en Venezuela.

### Capacidades que anuncia públicamente

| Área | Qué hace |
|---|---|
| Ventas | Registro de una venta en segundos, que descuenta inventario al instante |
| Inventario | Actualización automática por venta, compra o ajuste; organización por categorías, sucursales y almacenes; alertas de stock bajo |
| Cuentas | Cuentas por cobrar y por pagar, conciliación y cobranza |
| Clientes | Base de datos de clientes con CRM básico incluido en el plan |
| Multimoneda | Bolívares y dólares a la tasa del día, con IGTF cuando aplica |
| Multi-tienda | Panel centralizado con inventario, ventas y reportes por punto de venta en tiempo real |
| Reportes | Facturación, utilidad mensual, estadísticas del negocio en tiempo real |
| IA ("Nina") | Asistente que conoce inventario, ventas, clientes y cuentas, y responde en lenguaje natural |
| Carga por foto | Se fotografía la factura del proveedor y el sistema lee productos, cantidades y costos |
| Soporte | WhatsApp 24/7 y entrenamiento uno a uno |

> **Nota sobre la investigación.** La política de egreso de red de esta sesión
> bloquea `finapartner.com`, así que el sitio no pudo cargarse directamente. La
> descripción anterior proviene de fuentes públicas indexadas: la propia página
> de inicio, las secciones de funcionalidades y precios, y cobertura de prensa
> del levantamiento de capital de la empresa. No se copió código, diseño ni
> texto del producto original: lo que sigue es una reconstrucción funcional
> hecha desde cero.

### Arquitectura que se infiere del producto

Fina es una aplicación web multi-inquilino clásica:

- **SPA en el navegador** que habla con una **API HTTP**; no hay binario que instalar.
- **Base de datos relacional** por la naturaleza del dominio (documentos, líneas,
  saldos, existencias que deben cuadrar).
- **Modelo multi-inquilino**: cada negocio es un tenant con sus sucursales,
  usuarios y datos aislados.
- **Motor de moneda dual** en el corazón del dominio: el país factura en bolívares
  ante el SENIAT pero opera en dólares, así que cada documento debe guardar la
  tasa con la que se emitió.
- **Capa de IA** montada sobre los datos del negocio: consultas en lenguaje
  natural y extracción de datos desde imágenes de facturas.

---

## 2. Reglas del dominio venezolano

Son el núcleo del producto y lo que lo diferencia de cualquier ERP genérico.

**IVA — 16%.** Grava casi todo bien o servicio, sin importar en qué moneda se
pague. Se calcula por línea, porque puede haber productos exentos o con alícuota
distinta.

**IGTF — 3%.** Grava únicamente los pagos hechos en moneda distinta al bolívar:
efectivo en dólares, Zelle, USDT. Un pago móvil o una transferencia en bolívares
no lo generan. Se calcula **sobre el pago, no sobre la factura**: si el cliente
paga mitad en dólares y mitad en bolívares, solo la mitad en divisa tributa.

**Tasa BCV.** Obligatoria para facturar en divisas, declarar ante el SENIAT y
valorar inventarios. La factura debe reflejar el equivalente en bolívares a la
tasa del día.

### Cómo se modeló aquí

La moneda base es el **USD**, que es como razona el comerciante, y cada documento
guarda la tasa del día en que se emitió. Los montos en bolívares se derivan de
ahí, de modo que reimprimir una factura de hace tres meses da el mismo monto en
bolívares que el día que se emitió, aunque la tasa haya cambiado.

La secuencia de cálculo de una venta es:

```
subtotal        = Σ (cantidad × precio)
base imponible  = subtotal − descuentos
IVA             = Σ (neto de línea × alícuota de línea)
monto factura   = base imponible + IVA        ← esto es lo que cubren los pagos
IGTF            = 3% × Σ (pagos en divisa)    ← se cobra por encima
total           = monto factura + IGTF
saldo           = monto factura − pagado
```

Separar `monto factura` de `total` evita el problema circular de que el IGTF
dependa del pago y el pago dependa del total. El IGTF se trata como lo que es:
un impuesto de traspaso que se recauda junto con el cobro en divisa, no como
parte de la deuda del cliente.

---

## 3. Arquitectura del clon

```
┌──────────────────────────────────────────────────────────┐
│  Navegador                                               │
│  SPA React 18 + TypeScript + Vite                        │
│  Router del lado del cliente · sin dependencias de UI    │
└───────────────────────┬──────────────────────────────────┘
                        │ HTTPS · JSON · Bearer JWT
┌───────────────────────▼──────────────────────────────────┐
│  API Node 22 + TypeScript + Express                      │
│                                                          │
│  rutas/     validación con Zod, autorización por rol     │
│  modules/   dominio: ventas, compras, inventario,        │
│             tasa, reportes, asistente                    │
│  lib/       pool de conexiones, dinero, auth, errores    │
│                                                          │
│  Sirve además el SPA compilado desde ./publico           │
└───────────────────────┬──────────────────────────────────┘
                        │ SQL parametrizado (node-postgres)
┌───────────────────────▼──────────────────────────────────┐
│  PostgreSQL 16                                           │
│  Migraciones SQL versionadas, sin ORM                    │
└──────────────────────────────────────────────────────────┘
```

### Decisiones y por qué

**Sin ORM.** Se usa `pg` con SQL escrito a mano y migraciones versionadas. El
dominio es contable: importa el control exacto de transacciones, bloqueos de fila
y agregaciones. Un ORM añadiría descargas de binarios en el arranque y una capa
de indirección sobre consultas que de todos modos habría que escribir a mano.

**Sin framework de CSS.** La hoja de estilos es un sistema de diseño propio con
variables CSS y soporte de modo oscuro. Evita que el build dependa de binarios
nativos, y el CSS final pesa 14 kB.

**Una sola imagen Docker.** La API sirve también el SPA compilado, así que el
despliegue es `docker compose up -d` con dos contenedores: base de datos y
aplicación. No hay proxy inverso que configurar para que funcione.

**Migración al arrancar.** El servidor corre las migraciones pendientes antes de
escuchar. Actualizar es `docker compose up -d --build`, sin pasos manuales.

### Integridad de los datos

Lo que impide que el inventario y los saldos se descuadren:

- **Todo documento se escribe en una transacción.** Venta, líneas, movimientos de
  inventario y pagos entran o no entran juntos. Una venta que falla a mitad no
  deja stock descontado.
- **Bloqueo de fila al mover stock.** Antes de calcular el saldo nuevo se toma
  `SELECT … FOR UPDATE` sobre la existencia. Dos cajas vendiendo el mismo producto
  a la vez no pueden sobrevender.
- **Correlativos atómicos.** El número de factura se reserva con
  `UPDATE … RETURNING`, que mantiene la fila bloqueada hasta el commit. Nunca se
  repite un número.
- **Redondeo contable.** Todo monto persistido pasa por un redondeo a dos
  decimales con "half away from zero", que es el que espera un contador. Se evita
  así que sumar centavos acumule error binario.
- **Anulación en vez de borrado.** Una venta anulada conserva su registro,
  devuelve la mercancía al inventario y deja rastro del motivo y del momento.

### Seguridad

- Claves con bcrypt (coste 10); sesiones con JWT firmado y expiración configurable.
- Cinco roles: `PROPIETARIO`, `ADMIN`, `VENDEDOR`, `ALMACEN`, `CONTADOR`. Anular
  documentos y gestionar usuarios queda reservado a los dos primeros.
- El login responde igual ante correo inexistente y clave errada, para no revelar
  qué cuentas existen.
- Consultas siempre parametrizadas; ningún valor de usuario se concatena en SQL.
- `JWT_SECRET` menor a 32 caracteres hace fallar el arranque en producción.
- En producción los errores internos no exponen el mensaje original al cliente.
- El contenedor de PostgreSQL no publica puertos: solo es accesible desde la red
  interna de Compose.
- Tabla de auditoría con quién hizo qué y cuándo sobre los documentos.

---

## 4. Equivalencias con el producto original

| Fina | Aquí | Estado |
|---|---|---|
| Ventas y facturación | Punto de venta con cotización en vivo, pagos mixtos, IVA e IGTF | Completo |
| Inventario multi-almacén | Existencias por sucursal, ajustes, transferencias, kardex | Completo |
| Alertas de stock bajo | Sobre la existencia total, con detalle por almacén | Completo |
| Cuentas por cobrar y pagar | Antigüedad de saldos por tramos, abonos parciales | Completo |
| Clientes y CRM básico | Ficha con historial, límite de crédito y días de plazo | Completo |
| Compras a proveedores | Entrada de mercancía con costo promedio ponderado | Completo |
| Multimoneda Bs/USD | Tasa por documento, equivalentes en bolívares en toda la app | Completo |
| Multi-tienda | Sucursales y almacenes con panel unificado | Completo |
| Reportes en tiempo real | Panel, libro de ventas, rentabilidad, formas de cobro, valorización | Completo |
| Asistente "Nina" | Motor local determinista sobre datos reales; modo Claude opcional | Equivalente |
| Carga de factura por foto | No implementado | Pendiente |
| Soporte por WhatsApp | Fuera de alcance de un sistema autoalojado | N/A |

### Sobre el asistente

El modo por defecto (`ASISTENTE_MODO=local`) es un motor de intenciones que
reconoce preguntas frecuentes en español, ejecuta la consulta correspondiente y
responde con datos reales. **No sale a internet**, no requiere clave de API y
funciona sin conexión.

El modo opcional (`ASISTENTE_MODO=anthropic`) delega la redacción a Claude. En
ese caso se envía solo un resumen agregado de métricas del negocio, nunca datos
personales de clientes. Si la llamada falla, cae automáticamente al motor local.

Nunca se genera SQL a partir del texto del usuario. Las consultas están escritas
de antemano y la pregunta solo selecciona cuál ejecutar.

---

## 5. Lo que queda por hacer

- **OCR de facturas de proveedor**, la función de carga por foto. El punto de
  enganche existe: `POST /api/compras` ya acepta un documento completo, así que
  falta el extractor que convierta la imagen en líneas de compra.
- **Multi-inquilino real.** Hoy el esquema aloja una organización, que es lo
  correcto para un despliegue privado. Las tablas ya tienen `organizacion.id`
  para crecer hacia varios inquilinos si hiciera falta.
- **Notas de crédito y devoluciones parciales.** Hoy la anulación es total.
- **Impresión fiscal** contra impresoras homologadas por el SENIAT.

---

## Fuentes

- [Fina · sitio principal](https://www.finapartner.com/)
- [Funcionalidades del sistema](https://www.finapartner.com/funcionalidades)
- [Precios](https://www.finapartner.com/precios/)
- [Fina, SaaS venezolano para pymes, levanta US$1M — El Ecosistema Startup](https://ecosistemastartup.com/fina-saas-venezolano-para-pymes-levanta-us1m/)
- [Fina Partner levanta USD100.000 — Emprelatam](https://blog.emprelatam.com/2024/07/02/fina-partner-la-startup-que-revoluciona-la-gestion-administrativa-levanta-usd100-000/)
- [Cómo calcular el IGTF en Venezuela](https://www.usdt.com.ve/guias/como-calcular-igtf-venezuela)
- [IVA e IGTF en la facturación venezolana](https://bodegazo.com/blog/iva-igtf-facturacion-venezuela)
