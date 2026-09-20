import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, consulta } from '../lib/api';
import { useAvisos } from '../lib/avisos';
import { bs, numero, usd } from '../lib/formato';
import { AvisoError, Campo, ControlCantidad, Modal, Pastilla, Tarjeta } from '../componentes/ui';

interface Producto {
  id: number; sku: string; nombre: string; precio_usd: number; iva_tasa: number;
  tipo: 'BIEN' | 'SERVICIO'; existencia: number;
}
interface Cliente { id: number; nombre: string; documento: string; tipo_documento: string; dias_credito: number }
interface Metodo { codigo: string; nombre: string; moneda: 'USD' | 'VES'; aplica_igtf: boolean }
interface Sucursal { id: number; nombre: string; activa: boolean }

interface LineaCarrito { producto: Producto; cantidad: number; precioUsd: number; descuentoUsd: number }
interface PagoEditable { metodo: string; montoUsd: string; referencia: string }

interface Cotizacion {
  subtotal_usd: number; descuento_usd: number; base_imponible_usd: number; iva_usd: number;
  monto_factura_usd: number; igtf_usd: number; total_usd: number; pagado_usd: number;
  saldo_usd: number; total_bs: number; monto_factura_bs: number; tasa: number;
}

export function PuntoDeVenta() {
  const avisos = useAvisos();
  const [productos, setProductos] = useState<Producto[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [metodos, setMetodos] = useState<Metodo[]>([]);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);

  const [busqueda, setBusqueda] = useState('');
  const [sucursalId, setSucursalId] = useState<number | ''>('');
  const [carrito, setCarrito] = useState<LineaCarrito[]>([]);
  const [clienteId, setClienteId] = useState<number | ''>('');
  const [condicion, setCondicion] = useState<'CONTADO' | 'CREDITO'>('CONTADO');
  const [diasCredito, setDiasCredito] = useState(15);
  const [descuentoGlobal, setDescuentoGlobal] = useState('');
  const [pagos, setPagos] = useState<PagoEditable[]>([{ metodo: 'EFECTIVO_USD', montoUsd: '', referencia: '' }]);
  const [nota, setNota] = useState('');

  const [cotizacion, setCotizacion] = useState<Cotizacion | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [guardando, setGuardando] = useState(false);
  const [comprobante, setComprobante] = useState<any | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [p, c, m, s] = await Promise.all([
          api.get<{ datos: Producto[] }>('/productos?porPagina=400'),
          api.get<{ datos: Cliente[] }>('/clientes?porPagina=400'),
          api.get<{ datos: Metodo[] }>('/configuracion/metodos-pago'),
          api.get<{ datos: Sucursal[] }>('/configuracion/sucursales'),
        ]);
        setProductos(p.datos);
        setClientes(c.datos);
        setMetodos(m.datos);
        const activas = s.datos.filter((x) => x.activa);
        setSucursales(activas);
        if (activas[0]) setSucursalId(activas[0].id);
        if (m.datos[0]) setPagos([{ metodo: m.datos[0].codigo, montoUsd: '', referencia: '' }]);
      } catch (e) {
        setError(e);
      }
    })();
  }, []);

  const recargarProductos = useCallback(async () => {
    const p = await api.get<{ datos: Producto[] }>(`/productos${consulta({ porPagina: 400, sucursalId: sucursalId || undefined })}`);
    setProductos(p.datos);
  }, [sucursalId]);

  useEffect(() => {
    if (sucursalId) void recargarProductos();
  }, [sucursalId, recargarProductos]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const lista = q
      ? productos.filter((p) => p.nombre.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
      : productos;
    return lista.slice(0, 60);
  }, [productos, busqueda]);

  function agregar(producto: Producto) {
    setCarrito((previo) => {
      const existente = previo.find((l) => l.producto.id === producto.id);
      if (existente) {
        return previo.map((l) => (l.producto.id === producto.id ? { ...l, cantidad: l.cantidad + 1 } : l));
      }
      return [...previo, { producto, cantidad: 1, precioUsd: Number(producto.precio_usd), descuentoUsd: 0 }];
    });
  }

  const cuerpoVenta = useMemo(
    () => ({
      sucursalId: sucursalId || undefined,
      clienteId: clienteId || null,
      condicion,
      diasCredito: condicion === 'CREDITO' ? diasCredito : undefined,
      descuentoUsd: Number(descuentoGlobal) || undefined,
      nota: nota || undefined,
      lineas: carrito.map((l) => ({
        productoId: l.producto.id,
        cantidad: l.cantidad,
        precioUsd: l.precioUsd,
        descuentoUsd: l.descuentoUsd || undefined,
      })),
      pagos: pagos
        .filter((p) => Number(p.montoUsd) > 0)
        .map((p) => ({ metodo: p.metodo, montoUsd: Number(p.montoUsd), referencia: p.referencia || undefined })),
    }),
    [sucursalId, clienteId, condicion, diasCredito, descuentoGlobal, nota, carrito, pagos],
  );

  // Cotiza en el servidor con cada cambio: el total mostrado es el que se cobrara.
  useEffect(() => {
    if (carrito.length === 0) {
      setCotizacion(null);
      return;
    }
    let vigente = true;
    const id = setTimeout(async () => {
      try {
        const c = await api.post<Cotizacion>('/ventas/cotizar', { ...cuerpoVenta, condicion: undefined });
        if (vigente) {
          setCotizacion(c);
          setError(null);
        }
      } catch (e) {
        if (vigente) setError(e);
      }
    }, 180);
    return () => {
      vigente = false;
      clearTimeout(id);
    };
  }, [cuerpoVenta, carrito.length]);

  const faltaPorPagar = cotizacion ? Math.round((cotizacion.monto_factura_usd - cotizacion.pagado_usd) * 100) / 100 : 0;

  function completarPago(indice: number) {
    if (!cotizacion) return;
    const otros = pagos.reduce((a, p, i) => (i === indice ? a : a + (Number(p.montoUsd) || 0)), 0);
    const restante = Math.max(Math.round((cotizacion.monto_factura_usd - otros) * 100) / 100, 0);
    setPagos((previo) => previo.map((p, i) => (i === indice ? { ...p, montoUsd: String(restante) } : p)));
  }

  function limpiar() {
    setCarrito([]);
    setPagos((previo) => previo.slice(0, 1).map((p) => ({ ...p, montoUsd: '', referencia: '' })));
    setDescuentoGlobal('');
    setNota('');
    setClienteId('');
    setCondicion('CONTADO');
    setCotizacion(null);
    setError(null);
  }

  async function facturar() {
    setGuardando(true);
    setError(null);
    try {
      const venta = await api.post<any>('/ventas', cuerpoVenta);
      setComprobante(venta);
      avisos.exito(`Factura ${venta.numero} registrada por ${usd(venta.total_usd)}`);
      limpiar();
      void recargarProductos();
    } catch (e) {
      setError(e);
      avisos.error('No se pudo registrar la venta');
    } finally {
      setGuardando(false);
    }
  }

  const puedeFacturar =
    carrito.length > 0 &&
    !guardando &&
    (condicion === 'CREDITO' ? Boolean(clienteId) : Math.abs(faltaPorPagar) < 0.005);

  return (
    <div className="pos">
      <div className="pila">
        <Tarjeta
          titulo="Catalogo"
          acciones={
            <div className="fila">
              <select value={sucursalId} onChange={(e) => setSucursalId(Number(e.target.value))} style={{ width: 'auto' }}>
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
              <input
                placeholder="Buscar por nombre o SKU…"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                style={{ width: 240 }}
              />
            </div>
          }
        >
          <div className="pos__catalogo">
            {visibles.map((p) => {
              const sinStock = p.tipo === 'BIEN' && Number(p.existencia) <= 0;
              return (
                <button key={p.id} className="producto-boton" onClick={() => agregar(p)} disabled={sinStock}>
                  <span className="producto-boton__nombre">{p.nombre}</span>
                  <span className="producto-boton__precio">{usd(p.precio_usd)}</span>
                  <span className="producto-boton__meta">
                    {p.sku} · {p.tipo === 'SERVICIO' ? 'servicio' : `${numero(p.existencia)} und`}
                  </span>
                </button>
              );
            })}
            {visibles.length === 0 && <p className="tenue">Ningun producto coincide con la busqueda.</p>}
          </div>
        </Tarjeta>

        <Tarjeta titulo={`Carrito (${carrito.length})`} pegado>
          <div className="tabla-marco">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th style={{ width: 120 }}>Cantidad</th>
                  <th className="num" style={{ width: 110 }}>Precio</th>
                  <th className="num" style={{ width: 110 }}>Desc.</th>
                  <th className="num" style={{ width: 110 }}>Total</th>
                  <th style={{ width: 44 }} />
                </tr>
              </thead>
              <tbody>
                {carrito.length === 0 && (
                  <tr><td colSpan={6} className="tabla__vacia">Toca un producto del catalogo para empezar</td></tr>
                )}
                {carrito.map((l, i) => (
                  <tr key={l.producto.id}>
                    <td>
                      <div className="fuerte">{l.producto.nombre}</div>
                      <div className="mono tenue">{l.producto.sku} · IVA {numero(l.producto.iva_tasa)}%</div>
                    </td>
                    <td>
                      <ControlCantidad
                        valor={l.cantidad}
                        alCambiar={(v) => setCarrito((p) => p.map((x, j) => (j === i ? { ...x, cantidad: v } : x)))}
                      />
                    </td>
                    <td className="num">
                      <input
                        className="numerico"
                        type="number" step="0.01" min="0"
                        value={l.precioUsd}
                        onChange={(e) => setCarrito((p) => p.map((x, j) => (j === i ? { ...x, precioUsd: Number(e.target.value) } : x)))}
                      />
                    </td>
                    <td className="num">
                      <input
                        className="numerico"
                        type="number" step="0.01" min="0"
                        value={l.descuentoUsd || ''}
                        placeholder="0.00"
                        onChange={(e) => setCarrito((p) => p.map((x, j) => (j === i ? { ...x, descuentoUsd: Number(e.target.value) } : x)))}
                      />
                    </td>
                    <td className="num fuerte">{usd(l.cantidad * l.precioUsd - l.descuentoUsd)}</td>
                    <td>
                      <button
                        className="boton boton--fantasma boton--chico"
                        onClick={() => setCarrito((p) => p.filter((_, j) => j !== i))}
                        aria-label="Quitar"
                      >✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Tarjeta>
      </div>

      <div className="pila">
        <Tarjeta titulo="Cobro">
          <div className="pila pila--corta">
            <AvisoError error={error} />

            <Campo etiqueta="Cliente">
              <select value={clienteId} onChange={(e) => setClienteId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">Consumidor final</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre} · {c.tipo_documento}-{c.documento}</option>
                ))}
              </select>
            </Campo>

            <div className="fila">
              <Campo etiqueta="Condicion">
                <select value={condicion} onChange={(e) => setCondicion(e.target.value as 'CONTADO' | 'CREDITO')}>
                  <option value="CONTADO">De contado</option>
                  <option value="CREDITO">A credito</option>
                </select>
              </Campo>
              {condicion === 'CREDITO' && (
                <Campo etiqueta="Dias de credito">
                  <input type="number" min="0" value={diasCredito} onChange={(e) => setDiasCredito(Number(e.target.value))} />
                </Campo>
              )}
              <Campo etiqueta="Descuento global (USD)">
                <input className="numerico" type="number" step="0.01" min="0" placeholder="0.00"
                  value={descuentoGlobal} onChange={(e) => setDescuentoGlobal(e.target.value)} />
              </Campo>
            </div>

            <div className="separador" />

            <div className="totales">
              <div className="totales__fila"><span>Subtotal</span><span>{usd(cotizacion?.subtotal_usd ?? 0)}</span></div>
              {Number(cotizacion?.descuento_usd) > 0 && (
                <div className="totales__fila"><span>Descuento</span><span>− {usd(cotizacion?.descuento_usd)}</span></div>
              )}
              <div className="totales__fila"><span>Base imponible</span><span>{usd(cotizacion?.base_imponible_usd ?? 0)}</span></div>
              <div className="totales__fila"><span>IVA</span><span>{usd(cotizacion?.iva_usd ?? 0)}</span></div>
              {Number(cotizacion?.igtf_usd) > 0 && (
                <div className="totales__fila"><span>IGTF sobre divisas</span><span>{usd(cotizacion?.igtf_usd)}</span></div>
              )}
              <div className="totales__fila totales__fila--fuerte">
                <span>Total</span><span>{usd(cotizacion?.total_usd ?? 0)}</span>
              </div>
              <div className="totales__bs">{bs(cotizacion?.total_bs ?? 0)}</div>
            </div>

            {condicion === 'CONTADO' && (
              <>
                <div className="separador" />
                <div className="fila fila--entre">
                  <span className="campo__etiqueta">Formas de pago</span>
                  <button
                    className="boton boton--fantasma boton--chico"
                    onClick={() => setPagos((p) => [...p, { metodo: metodos[0]?.codigo ?? '', montoUsd: '', referencia: '' }])}
                  >+ agregar</button>
                </div>

                {pagos.map((pago, i) => {
                  const metodo = metodos.find((m) => m.codigo === pago.metodo);
                  return (
                    <div className="pila pila--corta" key={i} style={{ borderLeft: '2px solid var(--borde)', paddingLeft: 10 }}>
                      <div className="fila">
                        <select
                          value={pago.metodo}
                          onChange={(e) => setPagos((p) => p.map((x, j) => (j === i ? { ...x, metodo: e.target.value } : x)))}
                        >
                          {metodos.map((m) => (
                            <option key={m.codigo} value={m.codigo}>{m.nombre}{m.aplica_igtf ? ' · IGTF' : ''}</option>
                          ))}
                        </select>
                        <input
                          className="numerico" type="number" step="0.01" min="0" placeholder="0.00"
                          style={{ width: 110 }}
                          value={pago.montoUsd}
                          onChange={(e) => setPagos((p) => p.map((x, j) => (j === i ? { ...x, montoUsd: e.target.value } : x)))}
                        />
                        <button className="boton boton--neutro boton--chico" onClick={() => completarPago(i)} title="Cobrar el resto">
                          resto
                        </button>
                        {pagos.length > 1 && (
                          <button className="boton boton--fantasma boton--chico" onClick={() => setPagos((p) => p.filter((_, j) => j !== i))}>✕</button>
                        )}
                      </div>
                      {metodo && Number(pago.montoUsd) > 0 && (
                        <div className="pequeno tenue">
                          {metodo.moneda === 'VES' && cotizacion
                            ? `Equivale a ${bs(Number(pago.montoUsd) * cotizacion.tasa)}`
                            : metodo.aplica_igtf
                              ? `Genera IGTF de ${usd(Number(pago.montoUsd) * 0.03)}`
                              : null}
                        </div>
                      )}
                    </div>
                  );
                })}

                {cotizacion && Math.abs(faltaPorPagar) >= 0.005 && (
                  <div className={`aviso aviso--${faltaPorPagar > 0 ? 'aviso' : 'error'}`}>
                    {faltaPorPagar > 0
                      ? `Faltan ${usd(faltaPorPagar)} por cobrar`
                      : `Sobran ${usd(-faltaPorPagar)}: ajusta los montos`}
                  </div>
                )}
              </>
            )}

            {condicion === 'CREDITO' && !clienteId && (
              <div className="aviso aviso--aviso">Una venta a credito necesita un cliente identificado.</div>
            )}

            <Campo etiqueta="Nota (opcional)">
              <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Referencia interna" />
            </Campo>

            <div className="fila">
              <button className="boton boton--primario boton--grande crecer" disabled={!puedeFacturar} onClick={facturar}>
                {guardando ? 'Registrando…' : 'Facturar'}
              </button>
              <button className="boton boton--neutro boton--grande" onClick={limpiar} disabled={carrito.length === 0}>
                Limpiar
              </button>
            </div>
          </div>
        </Tarjeta>
      </div>

      {comprobante && (
        <Modal
          titulo={`Factura ${comprobante.numero}`}
          alCerrar={() => setComprobante(null)}
          pie={
            <>
              <button className="boton boton--neutro" onClick={() => window.print()}>Imprimir</button>
              <button className="boton boton--primario" onClick={() => setComprobante(null)}>Listo</button>
            </>
          }
        >
          <div className="pila pila--corta">
            <div className="fila fila--entre">
              <span className="tenue">{comprobante.cliente_nombre ?? 'Consumidor final'}</span>
              <Pastilla tono="exito">{comprobante.condicion}</Pastilla>
            </div>
            <table className="tabla">
              <tbody>
                {comprobante.lineas.map((l: any) => (
                  <tr key={l.id}>
                    <td>{l.descripcion}</td>
                    <td className="num">{numero(l.cantidad)} × {usd(l.precio_usd)}</td>
                    <td className="num fuerte">{usd(l.total_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="totales">
              <div className="totales__fila"><span>Base imponible</span><span>{usd(comprobante.base_imponible_usd)}</span></div>
              <div className="totales__fila"><span>IVA</span><span>{usd(comprobante.iva_usd)}</span></div>
              {Number(comprobante.igtf_usd) > 0 && (
                <div className="totales__fila"><span>IGTF</span><span>{usd(comprobante.igtf_usd)}</span></div>
              )}
              <div className="totales__fila totales__fila--fuerte"><span>Total</span><span>{usd(comprobante.total_usd)}</span></div>
              <div className="totales__bs">{bs(comprobante.totales_bs.total)} · tasa {numero(comprobante.tasa)}</div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
