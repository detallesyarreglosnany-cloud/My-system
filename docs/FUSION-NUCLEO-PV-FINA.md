# Fusión Núcleo PV + Fina — Informe y plan

> Análisis comparativo de los dos sistemas y plan para unirlos en uno solo.
> **Este documento no ejecuta nada.** Es la base para decidir.
> Septiembre 2026 · v1

---

## 1. La conclusión, primero

Los dos sistemas no compiten: se completan.

**Núcleo PV tiene el piso construido** — identidad, seguridad, clientes, auditoría — y
**no tiene nada del cuerpo**: no existe catálogo, ni inventario, ni ventas, ni pagos,
ni impuestos.

**Fina tiene exactamente ese cuerpo**, construido y probado, pero apoyado sobre un
piso propio que hay que descartar.

La fusión correcta es: **el piso de Núcleo PV + el cuerpo de Fina**, reescrito para
cumplir las reglas de Núcleo PV.

Y hay un hallazgo que cambia la hoja de ruta: **la Fase 1 no se puede construir
todavía**. Está planificada para hacer pedidos y crédito, pero un pedido necesita
productos, precios, existencia e impuestos, y ninguna fase construye eso. Falta un
escalón antes.

---

## 2. Qué existe de verdad hoy

No lo que dice la documentación, sino lo que está en el código.

### Núcleo PV (rama `main`, Fase 0 fusionada)

| Pieza | Estado |
|---|---|
| Autenticación, recuperación de clave, alta de usuarios | Construido |
| `employees` atado a Supabase Auth, con rol | Construido |
| `clients` con `credit_limit`, `credit_enabled`, `ever_had_credit` | Construido |
| `audit_log` | Construido |
| `login_attempts` (defensa contra fuerza bruta) | Construido |
| `org_settings` (nombre, logo, colores, moneda, zona horaria) | Construido — ya sirve para marca blanca |
| Seguridad por filas (RLS) con pruebas automáticas | Construido |
| Integración continua en GitHub Actions | Construido |
| **Catálogo, inventario, ventas, compras, pagos, impuestos, reportes** | **No existe nada** |

Son 6 tablas y 12 archivos de aplicación. Es un cimiento sólido y bien hecho, pero
es solo el cimiento.

### Fina (rama `claude/finapartner-local-setup-mhmcyz`)

| Pieza | Estado |
|---|---|
| Catálogo con categorías, IVA por producto, bien o servicio | Construido |
| Inventario por almacén, con bloqueo de fila contra sobreventa | Construido |
| Kardex: todo movimiento deja rastro con saldo resultante | Construido |
| Compras con costo promedio ponderado calculado en la base | Construido |
| Ventas con IVA por línea, descuentos y cotización previa | Construido |
| IGTF solo sobre lo cobrado en divisa, no sobre la factura | Construido |
| Tasa del día congelada en cada documento | Construido |
| Numeración de documentos sin huecos ni repeticiones | Construido |
| Cuentas por cobrar y por pagar con antigüedad por tramos | Construido |
| Libro de ventas en bolívares, exportable | Construido |
| Panel en tiempo real, rentabilidad por producto | Construido |
| Asistente de consultas en lenguaje natural | Construido |
| 21 pruebas automáticas en verde | Construido |

---

## 3. Dónde encaja cada pieza de Fina

Los 27 módulos de Núcleo PV, y qué aporta Fina a cada uno.

| Módulo de Núcleo PV | Qué aporta Fina | Qué falta construir |
|---|---|---|
| **1 · Ventas y pedidos** | Motor de línea, IVA, descuentos, cotización, numeración atómica | Separar VD/VC, captura sin conexión, semáforo, estados de cola, firma en entrega, fraccionamiento |
| **2 · Armado de carga** | Nada | Todo: selección, cierre, liquidación, hoja de carga, nota de despacho, vacíos |
| **3 · Pagos** | Pagos mixtos, IGTF, tasa congelada, abonos parciales | Comprobante por foto, lectura automática, cola de verificación, conciliación bancaria, duplicados |
| **4 · Inventario** | **Casi completo**: existencia por almacén, kardex, ajustes, transferencias, costo promedio, alertas de mínimo | Lotes con vencimiento, costeo FIFO opcional, cadena de frío, rotación lenta, vacíos |
| **5 · Proveedores** | Compras, costo promedio, cuentas por pagar con antigüedad | Retenciones de IVA, checklist de recepción de gandola |
| **6 · Clientes y crédito** | Historial de compras y pagos, límite de crédito, antigüedad de saldo | Semáforo, score sobre ventana móvil de 10, alias, agrupación de cuentas |
| **7 · Dashboard gerencial** | Panel con ventas, margen, cobranza, inventario, top productos | Vistas materializadas, gráficos, salud en una pantalla |
| **8 · Dashboard vendedor** | Nada | Todo |
| **10 · Contabilidad** | Libro de ventas, IVA débito, margen real, flujo por cobrar/pagar | Asientos de doble partida, cierre de período, punto de equilibrio |
| **11 · Regulatorio** | Libro de ventas en bolívares a la tasa de cada documento | Libro de compras, retenciones, formatos oficiales |
| **12 · Auditoría** | Tabla de auditoría con quién, qué y cuándo | Unificar con `audit_log`, hacerla de solo-agregar |
| **25 · Liquidación** | Nada | Todo |
| **26 · Áreas y permisos** | Cinco roles | Áreas configurables sobre los roles |

**Resumen**: Fina cubre por completo el Módulo 4, casi todo el 5, la mitad del 1, 3, 6,
7, 10 y 11. No toca el 2, 8, 25 ni 26.

---

## 4. Qué de Fina hay que descartar

Fina viola cinco reglas duras de Núcleo PV. No son preferencias, son decisiones ya
cerradas y con razón:

| Regla | Qué hace Fina | Por qué hay que cambiarlo |
|---|---|---|
| Dinero solo en `numeric` de la base | Calculaba en JavaScript | Ya costó un error real: el costo promedio se desviaba 3 céntimos por unidad, unos 9.000 USD de inventario mal valorado sobre 2.000 compras. Ya corregido, pero prueba que la regla es correcta |
| Identificadores generados en el dispositivo | Usa numeración automática de la base | Sin esto no hay captura sin conexión: el vendedor no puede crear un pedido en el teléfono si el número se lo tiene que dar el servidor |
| Seguridad por filas verificada | No la tiene | Es la segunda capa de defensa; sin ella un error en una consulta expone datos de otro |
| Rol derivado del token verificado | Emite su propio token | Núcleo PV ya tiene Supabase Auth; dos sistemas de sesión es una puerta de más |
| Un proyecto por cliente | Una sola organización | Es el modelo de marca blanca |

Además el stack no coincide: Núcleo PV es Next.js sobre Supabase; Fina es Express con
una SPA aparte.

**Traducción**: de Fina no se reutiliza el código, se reutiliza **el dominio** — las
reglas de negocio ya escritas, probadas y verificadas contra la realidad venezolana.
Eso es lo caro de descubrir; el código es lo barato de reescribir.

---

## 5. El hueco de la hoja de ruta

La Fase 1 se llama "Pedidos y Crédito". Para tomar un pedido hace falta:

- un producto, con precio y alícuota de IVA
- existencia disponible en algún almacén
- una tasa del día para expresar el monto en bolívares
- un documento numerado donde asentarlo

Ninguna fase construye eso. La Fase 0 construye identidad y clientes; la Fase 1 asume
el catálogo. **Falta un escalón entre las dos.**

Ese escalón es justamente lo que Fina ya tiene funcionando.

---

## 6. Plan de fusión

Respeta tu regla: una fase, un objetivo; nada se mezcla; cada fase termina con
auditoría, diferencias, explicación, riesgos y espera de tu autorización.

### Fase 1A — Catálogo e inventario

El escalón que falta. Traer de Fina, reescrito a las reglas de Núcleo PV:

- Productos con categorías, unidad, alícuota de IVA, bien o servicio
- Existencia por almacén, con bloqueo de fila que impide vender lo que no hay
- Kardex: cada movimiento con su saldo resultante, sin excepción
- Ajustes con motivo obligatorio y transferencias entre almacenes
- Compras con costo promedio ponderado calculado en la base
- Alertas de existencia bajo el mínimo
- **Nuevo, que Fina no tiene**: lotes con fecha de vencimiento, obligatorio para bebidas y víveres

### Fase 1B — Motor fiscal y documentos

- IVA por línea con alícuota heredada del producto
- IGTF solo sobre lo cobrado en divisa, calculado sobre el pago y no sobre la factura
- Tasa del día congelada en cada documento, de modo que reimprimir una factura vieja
  dé el mismo monto en bolívares
- Numeración atómica separada: **VD** para venta directa, **VC** para venta a crédito,
  decidida por el tipo de cliente y nunca por el método de pago
- Libro de ventas en bolívares a la tasa de cada documento

### Fase 1C — Pedidos y crédito (tu Fase 1 original)

Ahora sí se puede. Captura sin conexión, semáforo, estados de cola, firma en la
entrega, detección de fraccionamiento.

### Fase 2 en adelante

Sin cambios respecto a tu plan.

---

## 7. La capa transversal

Esto es lo que pediste que no se quedara corto, y es lo que separa un sistema que
funciona de uno que aguanta una distribuidora real. No es un módulo: es una capa que
**todos** los módulos usan.

### Búsqueda instantánea

Buscar un cliente por parte del nombre, del alias o del código, y que responda antes
de que termines de escribir. Se logra con índices de trigrama e insensibilidad a
acentos en la base, no filtrando en el navegador. Sobre 100.000 clientes debe
responder en menos de una décima de segundo. Lo mismo para productos y documentos.

### Historial de todo, sin excepción

- `audit_log` de solo agregar: nadie, ni el administrador, puede borrar una línea
- Historial de precios y costos: poder responder "¿a cuánto vendíamos esto el 3 de marzo?"
- Historial de cambios de límite de crédito, con quién lo cambió y por qué
- Anulaciones y devoluciones que nunca borran: marcan y contra-asientan

### Exportar e imprimir todo

Una sola herramienta, disponible en **cualquier** listado del sistema:

- CSV para hojas de cálculo
- Excel con formato, totales y filtros ya puestos
- PDF listo para imprimir o enviar
- ZIP con todo lo anterior más los adjuntos, para un paquete de disputa

Las columnas exportadas son las que ves en pantalla, con los mismos filtros aplicados.
Los exportes grandes salen por una cola y avisan cuando terminan, en vez de congelar
la pantalla.

Impresión: plantillas para factura, nota de despacho, hoja de carga y libro, con vista
previa y tamaño de papel. Para el mostrador, ticket térmico de 80 mm.

### Importar sin romper nada

Recibir CSV, Excel o ZIP para cargar catálogo, clientes, precios o el extracto
bancario. El proceso nunca importa a ciegas:

1. Se sube el archivo
2. El sistema lo valida y muestra un informe fila por fila: qué entra, qué se
   actualiza, qué está mal y por qué
3. Tú confirmas
4. Recién ahí se escribe

Si subes el mismo archivo dos veces, no duplica: lo reconoce por su huella.

### Automatización

Tareas que corren solas, sin que nadie se acuerde:

- Tasa del día, cargada cada mañana
- Cierre de jornada con resumen al gerente
- Aviso de lotes por vencer, antes de que venzan
- Detección de rotación lenta comparando cada producto contra su propio promedio
- Respaldo diario fuera de Supabase
- Recálculo de los tableros

Toda llamada externa va envuelta en tiempo de espera y reintentos; si falla tres
veces, va a una bandeja de trabajos atascados en vez de desaparecer en silencio.

### Velocidad con volumen

- Tableros sobre vistas materializadas, no sobre consultas que recorren todo
- Listados paginados por cursor, no por salto: la página 500 abre igual de rápido que la 1
- Índices pensados para las consultas reales, no puestos al azar

### Dinero trazable

Asientos de doble partida desde el primer día, no en la Fase 5. Así el margen y el
flujo de caja se leen de los asientos y no de recalcular documentos cada vez. Es más
trabajo al principio y ahorra meses después.

---

## 8. Lo que agregaría y no está en ningún documento

Como ingeniero, esto es lo que echo de menos para el negocio que describes:

1. **Devoluciones y notas de crédito parciales.** Fina solo anula la factura completa.
   Una distribuidora devuelve tres cajas de veinte, no el pedido entero.
2. **Retenciones de IVA a proveedores** (75% y 100%). Están en el Módulo 5 pero sin
   detalle, y en Venezuela son obligatorias.
3. **Precios por lista y por cliente.** Hoy hay un precio único por producto. Una
   distribuidora tiene precio de bodega, de mayorista y acuerdos puntuales.
4. **Unidades de empaque.** Vender por caja, por paquete o por unidad del mismo
   producto, con conversión automática al kardex.
5. **Bloqueo de período contable.** Cerrar un mes e impedir que alguien asiente hacia
   atrás sin autorización.
6. **Conteo físico de inventario guiado.** Hoja de conteo, captura, informe de
   diferencias y ajuste en bloque con un solo motivo.
7. **Modo mostrador rápido.** Teclado, lector de código de barras y cobro en menos de
   diez segundos, sin ratón. Fina ya tiene la base.
8. **Apagón y respaldo.** Venezuela tiene cortes. Que el mostrador siga cobrando sin
   internet y sincronice después, igual que el vendedor en ruta.
9. **Doble unidad de medida en reportes.** Todo reporte con su monto en dólares y en
   bolívares a la tasa del documento, nunca recalculado a la tasa de hoy.
10. **Sello de integridad.** Una cadena de huellas sobre el `audit_log` que permita
    demostrar que no se alteró, útil ante un reclamo o una fiscalización.

---

## 9. Riesgos que hay que mirar de frente

| Riesgo | Mitigación |
|---|---|
| Reescribir Fina es trabajo real, no copiar y pegar | Se reutiliza el dominio y las pruebas, que es lo que costó descubrir |
| Un solo desarrollador en un sistema que maneja dinero de terceros | Pruebas automáticas en cada fase, ya hay integración continua |
| La captura sin conexión es la parte más difícil de todo el sistema | Va en su propia fase, después de que el catálogo y los impuestos estén firmes |
| La doble partida encarece el arranque | Se construye simple: un asiento por documento, sin plan de cuentas completo |
| Sin lotes con vencimiento no se puede operar víveres | Entra en la primera fase, no se difiere |

---

## 10. Lo que necesito de ti para seguir

Nada más que una decisión: si el plan de fusión va, y por cuál fase empiezo.

Mi recomendación es empezar por la **Fase 1A**, catálogo e inventario, porque es el
escalón que falta y porque es la parte de Fina que llega más entera.

Ninguna línea de código se toca hasta que lo digas.
