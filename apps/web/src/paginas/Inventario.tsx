import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, consulta } from '../lib/api';
import { useAvisos } from '../lib/avisos';
import { fechaHora, numero, usd } from '../lib/formato';
import { AvisoError, Campo, Cargando, Modal, Pastilla, Tabla, Tarjeta } from '../componentes/ui';

interface Producto {
  id: number; sku: string; nombre: string; tipo: 'BIEN' | 'SERVICIO'; unidad: string;
  precio_usd: number; costo_usd: number; iva_tasa: number; stock_minimo: number;
  activo: boolean; existencia: number; categoria_id: number | null; categoria_nombre: string | null;
}
interface Categoria { id: number; nombre: string }
interface Sucursal { id: number; nombre: string; activa: boolean }

const PRODUCTO_VACIO = {
  sku: '', nombre: '', tipo: 'BIEN' as 'BIEN' | 'SERVICIO', unidad: 'UND',
  precioUsd: '', costoUsd: '', ivaTasa: '16', stockMinimo: '0', categoriaId: '' as number | '',
};

export function Inventario() {
  const avisos = useAvisos();
  const [productos, setProductos] = useState<Producto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [texto, setTexto] = useState('');
  const [sucursalId, setSucursalId] = useState<number | ''>('');
  const [soloAlertas, setSoloAlertas] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const [formulario, setFormulario] = useState<typeof PRODUCTO_VACIO | null>(null);
  const [editando, setEditando] = useState<Producto | null>(null);
  const [detalle, setDetalle] = useState<any | null>(null);
  const [ajuste, setAjuste] = useState({ sucursalId: '' as number | '', cantidadFinal: '', nota: '' });
  const [traspaso, setTraspaso] = useState({ origenId: '' as number | '', destinoId: '' as number | '', cantidad: '' });

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await api.get<{ datos: Producto[] }>(
        `/productos${consulta({ texto, sucursalId: sucursalId || undefined, porPagina: 300, soloActivos: 'false' })}`,
      );
      setProductos(r.datos);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setCargando(false);
    }
  }, [texto, sucursalId]);

  useEffect(() => { void cargar(); }, [cargar]);

  useEffect(() => {
    Promise.all([
      api.get<{ datos: Categoria[] }>('/configuracion/categorias'),
      api.get<{ datos: Sucursal[] }>('/configuracion/sucursales'),
    ])
      .then(([c, s]) => { setCategorias(c.datos); setSucursales(s.datos.filter((x) => x.activa)); })
      .catch(() => {});
  }, []);

  const visibles = soloAlertas
    ? productos.filter((p) => p.tipo === 'BIEN' && Number(p.stock_minimo) > 0 && Number(p.existencia) <= Number(p.stock_minimo))
    : productos;

  async function guardarProducto(e: FormEvent) {
    e.preventDefault();
    if (!formulario) return;
    const cuerpo = {
      sku: formulario.sku.trim(),
      nombre: formulario.nombre.trim(),
      tipo: formulario.tipo,
      unidad: formulario.unidad,
      precioUsd: Number(formulario.precioUsd) || 0,
      costoUsd: Number(formulario.costoUsd) || 0,
      ivaTasa: Number(formulario.ivaTasa) || 0,
      stockMinimo: Number(formulario.stockMinimo) || 0,
      categoriaId: formulario.categoriaId ? Number(formulario.categoriaId) : null,
    };
    try {
      if (editando) {
        await api.put(`/productos/${editando.id}`, cuerpo);
        avisos.exito('Producto actualizado');
      } else {
        await api.post('/productos', cuerpo);
        avisos.exito('Producto creado');
      }
      setFormulario(null);
      setEditando(null);
      void cargar();
    } catch (err) {
      avisos.error((err as Error).message);
    }
  }

  async function abrirDetalle(id: number) {
    try {
      const d = await api.get<any>(`/productos/${id}`);
      setDetalle(d);
      setAjuste({ sucursalId: d.existencias[0]?.sucursal_id ?? '', cantidadFinal: '', nota: '' });
      setTraspaso({ origenId: d.existencias[0]?.sucursal_id ?? '', destinoId: d.existencias[1]?.sucursal_id ?? '', cantidad: '' });
    } catch (e) {
      setError(e);
    }
  }

  async function aplicarAjuste() {
    if (!detalle || !ajuste.sucursalId) return;
    try {
      await api.post(`/productos/${detalle.id}/ajuste`, {
        sucursalId: Number(ajuste.sucursalId),
        cantidadFinal: Number(ajuste.cantidadFinal),
        nota: ajuste.nota || 'Ajuste manual',
      });
      avisos.exito('Existencia ajustada');
      await abrirDetalle(detalle.id);
      void cargar();
    } catch (e) {
      avisos.error((e as Error).message);
    }
  }

  async function aplicarTraspaso() {
    if (!detalle) return;
    try {
      await api.post(`/productos/${detalle.id}/transferencia`, {
        origenId: Number(traspaso.origenId),
        destinoId: Number(traspaso.destinoId),
        cantidad: Number(traspaso.cantidad),
      });
      avisos.exito('Transferencia realizada');
      await abrirDetalle(detalle.id);
      void cargar();
    } catch (e) {
      avisos.error((e as Error).message);
    }
  }

  return (
    <div className="pila">
      <Tarjeta
        titulo="Productos"
        acciones={
          <div className="fila">
            <input placeholder="Buscar…" value={texto} onChange={(e) => setTexto(e.target.value)} style={{ width: 200 }} />
            <select value={sucursalId} onChange={(e) => setSucursalId(e.target.value ? Number(e.target.value) : '')} style={{ width: 'auto' }}>
              <option value="">Todos los almacenes</option>
              {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
            <label className="fila" style={{ gap: 6 }}>
              <input type="checkbox" checked={soloAlertas} onChange={(e) => setSoloAlertas(e.target.checked)} />
              <span className="pequeno">Solo alertas</span>
            </label>
            <button className="boton boton--primario boton--chico" onClick={() => { setEditando(null); setFormulario({ ...PRODUCTO_VACIO }); }}>
              + Nuevo
            </button>
          </div>
        }
        pegado
      >
        {cargando ? <Cargando /> : (
          <Tabla
            columnas={[
              { titulo: 'Producto' }, { titulo: 'Categoria' }, { titulo: 'Existencia', num: true },
              { titulo: 'Minimo', num: true }, { titulo: 'Costo', num: true }, { titulo: 'Precio', num: true },
              { titulo: 'Margen', num: true }, { titulo: '' },
            ]}
            vacia="No hay productos que coincidan"
          >
            {visibles.map((p) => {
              const costo = Number(p.costo_usd);
              const precio = Number(p.precio_usd);
              const margen = precio > 0 ? ((precio - costo) / precio) * 100 : 0;
              const alerta = p.tipo === 'BIEN' && Number(p.stock_minimo) > 0 && Number(p.existencia) <= Number(p.stock_minimo);
              return (
                <tr key={p.id}>
                  <td>
                    <div className="fuerte">{p.nombre} {!p.activo && <Pastilla>inactivo</Pastilla>}</div>
                    <div className="mono tenue">{p.sku} · {p.tipo === 'SERVICIO' ? 'servicio' : p.unidad}</div>
                  </td>
                  <td className="tenue">{p.categoria_nombre ?? '—'}</td>
                  <td className="num">
                    {p.tipo === 'SERVICIO' ? <span className="tenue">—</span>
                      : alerta ? <Pastilla tono={Number(p.existencia) <= 0 ? 'peligro' : 'aviso'}>{numero(p.existencia)}</Pastilla>
                        : numero(p.existencia)}
                  </td>
                  <td className="num tenue">{numero(p.stock_minimo)}</td>
                  <td className="num">{usd(costo)}</td>
                  <td className="num fuerte">{usd(precio)}</td>
                  <td className="num">{margen.toFixed(0)}%</td>
                  <td className="apretado">
                    <button className="boton boton--neutro boton--chico" onClick={() => abrirDetalle(p.id)}>Ver</button>{' '}
                    <button
                      className="boton boton--fantasma boton--chico"
                      onClick={() => {
                        setEditando(p);
                        setFormulario({
                          sku: p.sku, nombre: p.nombre, tipo: p.tipo, unidad: p.unidad,
                          precioUsd: String(p.precio_usd), costoUsd: String(p.costo_usd),
                          ivaTasa: String(p.iva_tasa), stockMinimo: String(p.stock_minimo),
                          categoriaId: p.categoria_id ?? '',
                        });
                      }}
                    >Editar</button>
                  </td>
                </tr>
              );
            })}
          </Tabla>
        )}
      </Tarjeta>

      <AvisoError error={error} />

      {formulario && (
        <Modal
          titulo={editando ? `Editar ${editando.nombre}` : 'Nuevo producto'}
          alCerrar={() => { setFormulario(null); setEditando(null); }}
          pie={
            <>
              <button className="boton boton--neutro" onClick={() => { setFormulario(null); setEditando(null); }}>Cancelar</button>
              <button className="boton boton--primario" form="form-producto">Guardar</button>
            </>
          }
        >
          <form id="form-producto" onSubmit={guardarProducto} className="pila pila--corta">
            <div className="fila">
              <Campo etiqueta="SKU"><input required value={formulario.sku} onChange={(e) => setFormulario({ ...formulario, sku: e.target.value })} /></Campo>
              <Campo etiqueta="Tipo">
                <select value={formulario.tipo} onChange={(e) => setFormulario({ ...formulario, tipo: e.target.value as 'BIEN' | 'SERVICIO' })}>
                  <option value="BIEN">Bien (lleva inventario)</option>
                  <option value="SERVICIO">Servicio</option>
                </select>
              </Campo>
              <Campo etiqueta="Unidad"><input value={formulario.unidad} onChange={(e) => setFormulario({ ...formulario, unidad: e.target.value })} /></Campo>
            </div>
            <Campo etiqueta="Nombre"><input required value={formulario.nombre} onChange={(e) => setFormulario({ ...formulario, nombre: e.target.value })} /></Campo>
            <Campo etiqueta="Categoria">
              <select value={formulario.categoriaId} onChange={(e) => setFormulario({ ...formulario, categoriaId: e.target.value ? Number(e.target.value) : '' })}>
                <option value="">Sin categoria</option>
                {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </Campo>
            <div className="fila">
              <Campo etiqueta="Costo USD"><input className="numerico" type="number" step="0.01" min="0" value={formulario.costoUsd} onChange={(e) => setFormulario({ ...formulario, costoUsd: e.target.value })} /></Campo>
              <Campo etiqueta="Precio USD"><input className="numerico" type="number" step="0.01" min="0" required value={formulario.precioUsd} onChange={(e) => setFormulario({ ...formulario, precioUsd: e.target.value })} /></Campo>
              <Campo etiqueta="IVA %"><input className="numerico" type="number" step="0.01" min="0" max="100" value={formulario.ivaTasa} onChange={(e) => setFormulario({ ...formulario, ivaTasa: e.target.value })} /></Campo>
              <Campo etiqueta="Stock minimo"><input className="numerico" type="number" step="0.01" min="0" value={formulario.stockMinimo} onChange={(e) => setFormulario({ ...formulario, stockMinimo: e.target.value })} /></Campo>
            </div>
            {Number(formulario.precioUsd) > 0 && Number(formulario.costoUsd) > 0 && (
              <div className="aviso aviso--info">
                Margen bruto: {(((Number(formulario.precioUsd) - Number(formulario.costoUsd)) / Number(formulario.precioUsd)) * 100).toFixed(1)}%
              </div>
            )}
          </form>
        </Modal>
      )}

      {detalle && (
        <Modal ancho titulo={detalle.nombre} alCerrar={() => setDetalle(null)}
          pie={<button className="boton boton--neutro" onClick={() => setDetalle(null)}>Cerrar</button>}>
          <div className="pila">
            <div className="rejilla rejilla--2">
              <Tarjeta titulo="Existencias por almacen" pegado>
                <Tabla columnas={[{ titulo: 'Almacen' }, { titulo: 'Cantidad', num: true }]}>
                  {detalle.existencias.map((e: any) => (
                    <tr key={e.sucursal_id}>
                      <td>{e.sucursal}</td>
                      <td className="num fuerte">{numero(e.cantidad)}</td>
                    </tr>
                  ))}
                </Tabla>
              </Tarjeta>

              <div className="pila pila--corta">
                <Tarjeta titulo="Ajustar existencia">
                  <div className="fila">
                    <Campo etiqueta="Almacen">
                      <select value={ajuste.sucursalId} onChange={(e) => setAjuste({ ...ajuste, sucursalId: Number(e.target.value) })}>
                        {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                      </select>
                    </Campo>
                    <Campo etiqueta="Cantidad final">
                      <input className="numerico" type="number" step="0.01" min="0" value={ajuste.cantidadFinal}
                        onChange={(e) => setAjuste({ ...ajuste, cantidadFinal: e.target.value })} />
                    </Campo>
                    <Campo etiqueta="&nbsp;">
                      <button className="boton boton--primario" disabled={ajuste.cantidadFinal === ''} onClick={aplicarAjuste}>Ajustar</button>
                    </Campo>
                  </div>
                  <Campo etiqueta="Motivo" ayuda="Queda registrado en el historial de movimientos.">
                    <input value={ajuste.nota} onChange={(e) => setAjuste({ ...ajuste, nota: e.target.value })} placeholder="Ej. conteo fisico" />
                  </Campo>
                </Tarjeta>

                {sucursales.length > 1 && (
                  <Tarjeta titulo="Transferir entre almacenes">
                    <div className="fila">
                      <Campo etiqueta="Origen">
                        <select value={traspaso.origenId} onChange={(e) => setTraspaso({ ...traspaso, origenId: Number(e.target.value) })}>
                          {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                        </select>
                      </Campo>
                      <Campo etiqueta="Destino">
                        <select value={traspaso.destinoId} onChange={(e) => setTraspaso({ ...traspaso, destinoId: Number(e.target.value) })}>
                          {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                        </select>
                      </Campo>
                      <Campo etiqueta="Cantidad">
                        <input className="numerico" type="number" step="0.01" min="0" value={traspaso.cantidad}
                          onChange={(e) => setTraspaso({ ...traspaso, cantidad: e.target.value })} />
                      </Campo>
                      <Campo etiqueta="&nbsp;">
                        <button className="boton boton--primario" disabled={!(Number(traspaso.cantidad) > 0)} onClick={aplicarTraspaso}>Transferir</button>
                      </Campo>
                    </div>
                  </Tarjeta>
                )}
              </div>
            </div>

            <Tarjeta titulo="Ultimos movimientos" pegado>
              <Tabla
                columnas={[{ titulo: 'Fecha' }, { titulo: 'Tipo' }, { titulo: 'Almacen' }, { titulo: 'Cantidad', num: true }, { titulo: 'Saldo', num: true }, { titulo: 'Referencia' }]}
                vacia="Sin movimientos"
              >
                {detalle.movimientos.map((m: any) => (
                  <tr key={m.id}>
                    <td className="apretado">{fechaHora(m.creado_en)}</td>
                    <td><Pastilla tono={Number(m.cantidad) >= 0 ? 'exito' : 'neutra'}>{m.tipo}</Pastilla></td>
                    <td className="tenue">{m.sucursal}</td>
                    <td className="num fuerte">{Number(m.cantidad) > 0 ? '+' : ''}{numero(m.cantidad)}</td>
                    <td className="num">{numero(m.saldo_resultante)}</td>
                    <td className="tenue pequeno">{m.nota || '—'}</td>
                  </tr>
                ))}
              </Tabla>
            </Tarjeta>
          </div>
        </Modal>
      )}
    </div>
  );
}
