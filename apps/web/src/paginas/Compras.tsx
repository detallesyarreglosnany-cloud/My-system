import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, consulta } from '../lib/api';
import { useAvisos } from '../lib/avisos';
import { fecha, hoyIso, numero, usd } from '../lib/formato';
import { AvisoError, Campo, Cargando, Modal, Pastilla, Tabla, Tarjeta } from '../componentes/ui';

interface FilaCompra {
  id: number; numero: string; documento_proveedor: string; fecha: string; condicion: string;
  estado: string; total_usd: number; saldo_usd: number; vence_el: string | null; proveedor_nombre: string | null;
}
interface Producto { id: number; sku: string; nombre: string; costo_usd: number; iva_tasa: number; tipo: string }
interface Proveedor { id: number; nombre: string }
interface Sucursal { id: number; nombre: string; activa: boolean }
interface LineaCompra { productoId: number; nombre: string; cantidad: string; costoUsd: string; ivaTasa: number }

export function Compras() {
  const avisos = useAvisos();
  const [datos, setDatos] = useState<FilaCompra[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [detalle, setDetalle] = useState<any | null>(null);
  const [nueva, setNueva] = useState(false);

  const [productos, setProductos] = useState<Producto[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [metodos, setMetodos] = useState<Array<{ codigo: string; nombre: string }>>([]);

  const [formulario, setFormulario] = useState({
    proveedorId: '' as number | '', sucursalId: '' as number | '', documentoProveedor: '',
    condicion: 'CREDITO' as 'CONTADO' | 'CREDITO', diasCredito: 30, metodoPago: '', nota: '',
  });
  const [lineas, setLineas] = useState<LineaCompra[]>([]);
  const [buscar, setBuscar] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await api.get<{ datos: FilaCompra[] }>(`/compras${consulta({ soloPendientes: soloPendientes || undefined, porPagina: 100 })}`);
      setDatos(r.datos);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setCargando(false);
    }
  }, [soloPendientes]);

  useEffect(() => { void cargar(); }, [cargar]);

  useEffect(() => {
    Promise.all([
      api.get<{ datos: Producto[] }>('/productos?porPagina=400'),
      api.get<{ datos: Proveedor[] }>('/proveedores?porPagina=200'),
      api.get<{ datos: Sucursal[] }>('/configuracion/sucursales'),
      api.get<{ datos: Array<{ codigo: string; nombre: string }> }>('/configuracion/metodos-pago'),
    ])
      .then(([p, pr, s, m]) => {
        setProductos(p.datos.filter((x) => x.tipo === 'BIEN'));
        setProveedores(pr.datos);
        const activas = s.datos.filter((x) => x.activa);
        setSucursales(activas);
        setMetodos(m.datos);
        setFormulario((f) => ({ ...f, sucursalId: activas[0]?.id ?? '', metodoPago: m.datos[0]?.codigo ?? '' }));
      })
      .catch(() => {});
  }, []);

  const totales = useMemo(() => {
    let subtotal = 0;
    let iva = 0;
    for (const l of lineas) {
      const neto = Math.round(Number(l.cantidad) * Number(l.costoUsd) * 100) / 100 || 0;
      subtotal += neto;
      iva += Math.round((neto * l.ivaTasa) / 100 * 100) / 100;
    }
    return { subtotal, iva, total: Math.round((subtotal + iva) * 100) / 100 };
  }, [lineas]);

  const candidatos = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    if (!q) return [];
    return productos.filter((p) => p.nombre.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)).slice(0, 8);
  }, [productos, buscar]);

  function agregar(p: Producto) {
    if (lineas.some((l) => l.productoId === p.id)) return;
    setLineas((previo) => [...previo, { productoId: p.id, nombre: p.nombre, cantidad: '1', costoUsd: String(p.costo_usd), ivaTasa: Number(p.iva_tasa) }]);
    setBuscar('');
  }

  async function guardar() {
    setGuardando(true);
    try {
      await api.post('/compras', {
        proveedorId: formulario.proveedorId || null,
        sucursalId: formulario.sucursalId || undefined,
        documentoProveedor: formulario.documentoProveedor || undefined,
        condicion: formulario.condicion,
        diasCredito: formulario.condicion === 'CREDITO' ? formulario.diasCredito : undefined,
        nota: formulario.nota || undefined,
        lineas: lineas.map((l) => ({ productoId: l.productoId, cantidad: Number(l.cantidad), costoUsd: Number(l.costoUsd) })),
        pagos: formulario.condicion === 'CONTADO' ? [{ metodo: formulario.metodoPago, montoUsd: totales.total }] : [],
      });
      avisos.exito('Compra registrada y existencias actualizadas');
      setNueva(false);
      setLineas([]);
      void cargar();
    } catch (e) {
      avisos.error((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  async function abonar(compra: any) {
    const monto = Number(compra.saldo_usd);
    try {
      const r = await api.post(`/compras/${compra.id}/abono`, { metodo: metodos[0]?.codigo, montoUsd: monto });
      setDetalle(r);
      avisos.exito(`Pago de ${usd(monto)} registrado`);
      void cargar();
    } catch (e) {
      avisos.error((e as Error).message);
    }
  }

  return (
    <div className="pila">
      <Tarjeta
        titulo="Compras a proveedores"
        acciones={
          <div className="fila">
            <label className="fila" style={{ gap: 6 }}>
              <input type="checkbox" checked={soloPendientes} onChange={(e) => setSoloPendientes(e.target.checked)} />
              <span className="pequeno">Solo pendientes</span>
            </label>
            <button className="boton boton--primario boton--chico" onClick={() => setNueva(true)}>+ Registrar compra</button>
          </div>
        }
        pegado
      >
        {cargando ? <Cargando /> : (
          <Tabla
            columnas={[{ titulo: 'Numero' }, { titulo: 'Factura prov.' }, { titulo: 'Proveedor' }, { titulo: 'Fecha' },
              { titulo: 'Total', num: true }, { titulo: 'Saldo', num: true }, { titulo: 'Estado' }, { titulo: '' }]}
            vacia="Aun no hay compras registradas"
          >
            {datos.map((c) => (
              <tr key={c.id}>
                <td className="mono fuerte">{c.numero}</td>
                <td className="mono tenue">{c.documento_proveedor || '—'}</td>
                <td>{c.proveedor_nombre ?? <span className="tenue">Sin proveedor</span>}</td>
                <td className="apretado">{fecha(c.fecha)}</td>
                <td className="num fuerte">{usd(c.total_usd)}</td>
                <td className="num">
                  {Number(c.saldo_usd) > 0
                    ? <Pastilla tono={c.vence_el && new Date(c.vence_el) < new Date() ? 'peligro' : 'aviso'}>{usd(c.saldo_usd)}</Pastilla>
                    : <span className="tenue">pagada</span>}
                </td>
                <td><Pastilla tono={c.estado === 'ANULADA' ? 'peligro' : 'exito'}>{c.estado}</Pastilla></td>
                <td>
                  <button className="boton boton--neutro boton--chico" onClick={async () => setDetalle(await api.get(`/compras/${c.id}`))}>Ver</button>
                </td>
              </tr>
            ))}
          </Tabla>
        )}
      </Tarjeta>

      <AvisoError error={error} />

      {nueva && (
        <Modal
          ancho
          titulo="Registrar compra"
          alCerrar={() => setNueva(false)}
          pie={
            <>
              <button className="boton boton--neutro" onClick={() => setNueva(false)}>Cancelar</button>
              <button className="boton boton--primario" disabled={lineas.length === 0 || guardando} onClick={guardar}>
                {guardando ? 'Guardando…' : `Registrar ${usd(totales.total)}`}
              </button>
            </>
          }
        >
          <div className="pila">
            <div className="fila">
              <Campo etiqueta="Proveedor">
                <select value={formulario.proveedorId} onChange={(e) => setFormulario({ ...formulario, proveedorId: e.target.value ? Number(e.target.value) : '' })}>
                  <option value="">Sin proveedor</option>
                  {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </Campo>
              <Campo etiqueta="Factura del proveedor">
                <input value={formulario.documentoProveedor} onChange={(e) => setFormulario({ ...formulario, documentoProveedor: e.target.value })} placeholder="FAC-00123" />
              </Campo>
              <Campo etiqueta="Almacen de entrada">
                <select value={formulario.sucursalId} onChange={(e) => setFormulario({ ...formulario, sucursalId: Number(e.target.value) })}>
                  {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </Campo>
              <Campo etiqueta="Condicion">
                <select value={formulario.condicion} onChange={(e) => setFormulario({ ...formulario, condicion: e.target.value as 'CONTADO' })}>
                  <option value="CREDITO">A credito</option>
                  <option value="CONTADO">De contado</option>
                </select>
              </Campo>
              {formulario.condicion === 'CREDITO' ? (
                <Campo etiqueta="Dias">
                  <input type="number" min="0" value={formulario.diasCredito} onChange={(e) => setFormulario({ ...formulario, diasCredito: Number(e.target.value) })} />
                </Campo>
              ) : (
                <Campo etiqueta="Metodo de pago">
                  <select value={formulario.metodoPago} onChange={(e) => setFormulario({ ...formulario, metodoPago: e.target.value })}>
                    {metodos.map((m) => <option key={m.codigo} value={m.codigo}>{m.nombre}</option>)}
                  </select>
                </Campo>
              )}
            </div>

            <Campo etiqueta="Agregar producto">
              <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Busca por nombre o SKU…" />
            </Campo>
            {candidatos.length > 0 && (
              <div className="fila">
                {candidatos.map((p) => (
                  <button key={p.id} className="sugerencia" onClick={() => agregar(p)}>{p.nombre}</button>
                ))}
              </div>
            )}

            <Tabla
              columnas={[{ titulo: 'Producto' }, { titulo: 'Cantidad', num: true }, { titulo: 'Costo unit.', num: true },
                { titulo: 'IVA', num: true }, { titulo: 'Total', num: true }, { titulo: '' }]}
              vacia="Agrega los productos que estas comprando"
            >
              {lineas.map((l, i) => {
                const neto = Number(l.cantidad) * Number(l.costoUsd) || 0;
                return (
                  <tr key={l.productoId}>
                    <td className="fuerte">{l.nombre}</td>
                    <td className="num">
                      <input className="numerico" type="number" step="0.01" min="0" value={l.cantidad}
                        onChange={(e) => setLineas((p) => p.map((x, j) => (j === i ? { ...x, cantidad: e.target.value } : x)))} />
                    </td>
                    <td className="num">
                      <input className="numerico" type="number" step="0.01" min="0" value={l.costoUsd}
                        onChange={(e) => setLineas((p) => p.map((x, j) => (j === i ? { ...x, costoUsd: e.target.value } : x)))} />
                    </td>
                    <td className="num tenue">{numero(l.ivaTasa)}%</td>
                    <td className="num fuerte">{usd(neto * (1 + l.ivaTasa / 100))}</td>
                    <td>
                      <button className="boton boton--fantasma boton--chico" onClick={() => setLineas((p) => p.filter((_, j) => j !== i))}>✕</button>
                    </td>
                  </tr>
                );
              })}
            </Tabla>

            <div className="totales">
              <div className="totales__fila"><span>Subtotal</span><span>{usd(totales.subtotal)}</span></div>
              <div className="totales__fila"><span>IVA (credito fiscal)</span><span>{usd(totales.iva)}</span></div>
              <div className="totales__fila totales__fila--fuerte"><span>Total</span><span>{usd(totales.total)}</span></div>
            </div>

            <div className="aviso aviso--info">
              Al guardar, la existencia sube en el almacen elegido y el costo promedio de cada producto se recalcula.
            </div>
          </div>
        </Modal>
      )}

      {detalle && (
        <Modal
          ancho
          titulo={`Compra ${detalle.numero}`}
          alCerrar={() => setDetalle(null)}
          pie={
            <>
              {detalle.estado === 'EMITIDA' && Number(detalle.saldo_usd) > 0 && (
                <button className="boton boton--primario" onClick={() => abonar(detalle)}>Pagar {usd(detalle.saldo_usd)}</button>
              )}
              <button className="boton boton--neutro" onClick={() => setDetalle(null)}>Cerrar</button>
            </>
          }
        >
          <div className="pila">
            <div className="rejilla rejilla--4">
              <div><div className="campo__etiqueta">Proveedor</div><div className="fuerte">{detalle.proveedor_nombre ?? '—'}</div></div>
              <div><div className="campo__etiqueta">Fecha</div><div>{fecha(detalle.fecha)}</div></div>
              <div><div className="campo__etiqueta">Vence</div><div>{detalle.vence_el ? fecha(detalle.vence_el) : '—'}</div></div>
              <div><div className="campo__etiqueta">Saldo</div><div className="fuerte">{usd(detalle.saldo_usd)}</div></div>
            </div>
            <Tabla columnas={[{ titulo: 'Producto' }, { titulo: 'Cant.', num: true }, { titulo: 'Costo', num: true }, { titulo: 'Total', num: true }]}>
              {detalle.lineas.map((l: any) => (
                <tr key={l.id}>
                  <td>{l.descripcion}<div className="mono tenue">{l.sku ?? '—'}</div></td>
                  <td className="num">{numero(l.cantidad)}</td>
                  <td className="num">{usd(l.costo_usd)}</td>
                  <td className="num fuerte">{usd(l.total_usd)}</td>
                </tr>
              ))}
            </Tabla>
            <Tabla columnas={[{ titulo: 'Pago' }, { titulo: 'Monto', num: true }, { titulo: 'Fecha' }]} vacia="Sin pagos registrados">
              {detalle.pagos.map((p: any) => (
                <tr key={p.id}>
                  <td>{p.metodo_nombre}</td>
                  <td className="num">{usd(p.monto_usd)}</td>
                  <td className="apretado">{fecha(p.fecha) || hoyIso()}</td>
                </tr>
              ))}
            </Tabla>
          </div>
        </Modal>
      )}
    </div>
  );
}
