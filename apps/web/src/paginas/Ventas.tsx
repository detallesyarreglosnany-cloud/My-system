import { useCallback, useEffect, useState } from 'react';
import { api, consulta } from '../lib/api';
import { useAvisos } from '../lib/avisos';
import { esAdministrador, useSesion } from '../lib/sesion';
import { bs, fecha, fechaHora, hoyIso, numero, primerDiaDelMes, usd } from '../lib/formato';
import { AvisoError, Campo, Cargando, Modal, Pastilla, Tabla, Tarjeta } from '../componentes/ui';

interface FilaVenta {
  id: number; numero: string; fecha: string; condicion: string; estado: string;
  total_usd: number; saldo_usd: number; iva_usd: number; igtf_usd: number;
  vence_el: string | null; cliente_nombre: string | null; usuario_nombre: string | null;
}

export function Ventas() {
  const { usuario } = useSesion();
  const avisos = useAvisos();
  const [filtros, setFiltros] = useState({ desde: primerDiaDelMes(), hasta: hoyIso(), texto: '', soloPendientes: false });
  const [datos, setDatos] = useState<FilaVenta[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [detalle, setDetalle] = useState<any | null>(null);
  const [motivoAnulacion, setMotivoAnulacion] = useState('');
  const [abono, setAbono] = useState<{ metodo: string; monto: string; referencia: string } | null>(null);
  const [metodos, setMetodos] = useState<Array<{ codigo: string; nombre: string }>>([]);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await api.get<{ datos: FilaVenta[]; total: number }>(
        `/ventas${consulta({ ...filtros, soloPendientes: filtros.soloPendientes || undefined, pagina, porPagina: 25 })}`,
      );
      setDatos(r.datos);
      setTotal(r.total);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setCargando(false);
    }
  }, [filtros, pagina]);

  useEffect(() => { void cargar(); }, [cargar]);
  useEffect(() => {
    api.get<{ datos: Array<{ codigo: string; nombre: string }> }>('/configuracion/metodos-pago')
      .then((r) => setMetodos(r.datos))
      .catch(() => {});
  }, []);

  async function abrir(id: number) {
    try {
      setDetalle(await api.get(`/ventas/${id}`));
      setMotivoAnulacion('');
      setAbono(null);
    } catch (e) {
      setError(e);
    }
  }

  async function anular() {
    if (!detalle) return;
    try {
      const actualizada = await api.post(`/ventas/${detalle.id}/anular`, { motivo: motivoAnulacion });
      setDetalle(actualizada);
      avisos.exito('Venta anulada y mercancia devuelta al inventario');
      void cargar();
    } catch (e) {
      avisos.error((e as Error).message);
    }
  }

  async function registrarAbono() {
    if (!detalle || !abono) return;
    try {
      const actualizada = await api.post(`/ventas/${detalle.id}/abono`, {
        metodo: abono.metodo,
        montoUsd: Number(abono.monto),
        referencia: abono.referencia || undefined,
      });
      setDetalle(actualizada);
      setAbono(null);
      avisos.exito('Abono registrado');
      void cargar();
    } catch (e) {
      avisos.error((e as Error).message);
    }
  }

  const paginas = Math.max(Math.ceil(total / 25), 1);

  return (
    <div className="pila">
      <Tarjeta titulo="Filtros">
        <div className="fila">
          <Campo etiqueta="Desde">
            <input type="date" value={filtros.desde} onChange={(e) => { setPagina(1); setFiltros({ ...filtros, desde: e.target.value }); }} />
          </Campo>
          <Campo etiqueta="Hasta">
            <input type="date" value={filtros.hasta} onChange={(e) => { setPagina(1); setFiltros({ ...filtros, hasta: e.target.value }); }} />
          </Campo>
          <Campo etiqueta="Buscar">
            <input placeholder="Numero o cliente" value={filtros.texto}
              onChange={(e) => { setPagina(1); setFiltros({ ...filtros, texto: e.target.value }); }} />
          </Campo>
          <Campo etiqueta="&nbsp;">
            <label className="fila" style={{ gap: 6 }}>
              <input type="checkbox" checked={filtros.soloPendientes}
                onChange={(e) => { setPagina(1); setFiltros({ ...filtros, soloPendientes: e.target.checked }); }} />
              <span>Solo con saldo pendiente</span>
            </label>
          </Campo>
        </div>
      </Tarjeta>

      <AvisoError error={error} />

      <Tarjeta
        titulo={`Facturas (${numero(total)})`}
        acciones={
          <div className="fila">
            <button className="boton boton--neutro boton--chico" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>Anterior</button>
            <span className="pequeno tenue">{pagina} / {paginas}</span>
            <button className="boton boton--neutro boton--chico" disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)}>Siguiente</button>
          </div>
        }
        pegado
      >
        {cargando ? <Cargando /> : (
          <Tabla
            columnas={[
              { titulo: 'Numero' }, { titulo: 'Fecha' }, { titulo: 'Cliente' }, { titulo: 'Condicion' },
              { titulo: 'Total', num: true }, { titulo: 'Saldo', num: true }, { titulo: 'Estado' }, { titulo: '' },
            ]}
            vacia="No hay facturas en este rango"
          >
            {datos.map((v) => (
              <tr key={v.id}>
                <td className="mono fuerte">{v.numero}</td>
                <td className="apretado">{fecha(v.fecha)}</td>
                <td>{v.cliente_nombre ?? <span className="tenue">Consumidor final</span>}</td>
                <td>
                  <Pastilla tono={v.condicion === 'CREDITO' ? 'info' : 'neutra'}>{v.condicion}</Pastilla>
                </td>
                <td className="num fuerte">{usd(v.total_usd)}</td>
                <td className="num">
                  {Number(v.saldo_usd) > 0
                    ? <Pastilla tono={v.vence_el && new Date(v.vence_el) < new Date() ? 'peligro' : 'aviso'}>{usd(v.saldo_usd)}</Pastilla>
                    : <span className="tenue">—</span>}
                </td>
                <td>
                  <Pastilla tono={v.estado === 'ANULADA' ? 'peligro' : 'exito'}>{v.estado}</Pastilla>
                </td>
                <td>
                  <button className="boton boton--neutro boton--chico" onClick={() => abrir(v.id)}>Ver</button>
                </td>
              </tr>
            ))}
          </Tabla>
        )}
      </Tarjeta>

      {detalle && (
        <Modal
          ancho
          titulo={
            <div className="fila">
              <h2>Factura {detalle.numero}</h2>
              <Pastilla tono={detalle.estado === 'ANULADA' ? 'peligro' : 'exito'}>{detalle.estado}</Pastilla>
            </div>
          }
          alCerrar={() => setDetalle(null)}
          pie={<button className="boton boton--neutro" onClick={() => setDetalle(null)}>Cerrar</button>}
        >
          <div className="pila">
            <div className="rejilla rejilla--4">
              <div><div className="campo__etiqueta">Cliente</div><div className="fuerte">{detalle.cliente_nombre ?? 'Consumidor final'}</div></div>
              <div><div className="campo__etiqueta">Emitida</div><div>{fechaHora(detalle.fecha)}</div></div>
              <div><div className="campo__etiqueta">Vendedor</div><div>{detalle.usuario_nombre ?? '—'}</div></div>
              <div><div className="campo__etiqueta">Tasa aplicada</div><div className="num">{bs(detalle.tasa)}</div></div>
            </div>

            <Tabla columnas={[{ titulo: 'Producto' }, { titulo: 'Cant.', num: true }, { titulo: 'Precio', num: true }, { titulo: 'IVA', num: true }, { titulo: 'Total', num: true }]}>
              {detalle.lineas.map((l: any) => (
                <tr key={l.id}>
                  <td><div className="fuerte">{l.descripcion}</div><div className="mono tenue">{l.sku ?? '—'}</div></td>
                  <td className="num">{numero(l.cantidad)}</td>
                  <td className="num">{usd(l.precio_usd)}</td>
                  <td className="num">{usd(l.iva_usd)}</td>
                  <td className="num fuerte">{usd(l.total_usd)}</td>
                </tr>
              ))}
            </Tabla>

            <div className="rejilla rejilla--2">
              <div className="totales">
                <div className="totales__fila"><span>Base imponible</span><span>{usd(detalle.base_imponible_usd)} · {bs(detalle.totales_bs.base_imponible)}</span></div>
                <div className="totales__fila"><span>IVA</span><span>{usd(detalle.iva_usd)} · {bs(detalle.totales_bs.iva)}</span></div>
                <div className="totales__fila"><span>IGTF</span><span>{usd(detalle.igtf_usd)} · {bs(detalle.totales_bs.igtf)}</span></div>
                <div className="totales__fila totales__fila--fuerte"><span>Total</span><span>{usd(detalle.total_usd)}</span></div>
                <div className="totales__bs">{bs(detalle.totales_bs.total)}</div>
                <div className="totales__fila"><span>Pagado</span><span>{usd(detalle.pagado_usd)}</span></div>
                <div className="totales__fila"><span>Saldo</span><span className="fuerte">{usd(detalle.saldo_usd)}</span></div>
              </div>

              <div className="pila pila--corta">
                <h3>Pagos recibidos</h3>
                <Tabla columnas={[{ titulo: 'Metodo' }, { titulo: 'Monto', num: true }, { titulo: 'IGTF', num: true }, { titulo: 'Fecha' }]} vacia="Sin pagos">
                  {detalle.pagos.map((p: any) => (
                    <tr key={p.id}>
                      <td>{p.metodo_nombre}<div className="mono tenue">{p.referencia || '—'}</div></td>
                      <td className="num">{usd(p.monto_usd)}<div className="pequeno tenue">{bs(p.monto_bs)}</div></td>
                      <td className="num">{usd(p.igtf_usd)}</td>
                      <td className="apretado">{fecha(p.fecha)}</td>
                    </tr>
                  ))}
                </Tabla>
              </div>
            </div>

            {detalle.estado === 'EMITIDA' && Number(detalle.saldo_usd) > 0 && (
              <Tarjeta titulo="Registrar abono">
                {abono ? (
                  <div className="fila">
                    <Campo etiqueta="Metodo">
                      <select value={abono.metodo} onChange={(e) => setAbono({ ...abono, metodo: e.target.value })}>
                        {metodos.map((m) => <option key={m.codigo} value={m.codigo}>{m.nombre}</option>)}
                      </select>
                    </Campo>
                    <Campo etiqueta="Monto USD">
                      <input className="numerico" type="number" step="0.01" min="0" max={detalle.saldo_usd}
                        value={abono.monto} onChange={(e) => setAbono({ ...abono, monto: e.target.value })} />
                    </Campo>
                    <Campo etiqueta="Referencia">
                      <input value={abono.referencia} onChange={(e) => setAbono({ ...abono, referencia: e.target.value })} />
                    </Campo>
                    <Campo etiqueta="&nbsp;">
                      <div className="fila">
                        <button className="boton boton--primario" onClick={registrarAbono} disabled={!(Number(abono.monto) > 0)}>Guardar</button>
                        <button className="boton boton--fantasma" onClick={() => setAbono(null)}>Cancelar</button>
                      </div>
                    </Campo>
                  </div>
                ) : (
                  <button
                    className="boton boton--primario"
                    onClick={() => setAbono({ metodo: metodos[0]?.codigo ?? '', monto: String(detalle.saldo_usd), referencia: '' })}
                  >
                    Cobrar {usd(detalle.saldo_usd)}
                  </button>
                )}
              </Tarjeta>
            )}

            {detalle.estado === 'EMITIDA' && esAdministrador(usuario?.rol) && (
              <Tarjeta titulo="Anular factura">
                <div className="fila">
                  <Campo etiqueta="Motivo" ayuda="La mercancia vuelve al inventario y el saldo queda en cero.">
                    <input value={motivoAnulacion} onChange={(e) => setMotivoAnulacion(e.target.value)} placeholder="Ej. error de facturacion" />
                  </Campo>
                  <Campo etiqueta="&nbsp;">
                    <button className="boton boton--peligro" disabled={motivoAnulacion.trim().length < 3} onClick={anular}>Anular</button>
                  </Campo>
                </div>
              </Tarjeta>
            )}

            {detalle.estado === 'ANULADA' && (
              <div className="aviso aviso--error">
                Anulada el {fechaHora(detalle.anulada_en)} · {detalle.anulada_motivo}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
