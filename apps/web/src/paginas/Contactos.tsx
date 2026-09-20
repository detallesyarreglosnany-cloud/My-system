import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, consulta } from '../lib/api';
import { useAvisos } from '../lib/avisos';
import { fecha, usd } from '../lib/formato';
import { AvisoError, Campo, Cargando, Modal, Pastilla, Tabla, Tarjeta } from '../componentes/ui';

interface Contacto {
  id: number; tipo_documento: string; documento: string; nombre: string; email: string;
  telefono: string; direccion: string; activo: boolean; saldo_usd: number;
  limite_credito_usd?: number; dias_credito?: number;
}

const VACIO = {
  tipoDocumento: 'V', documento: '', nombre: '', email: '', telefono: '', direccion: '',
  limiteCreditoUsd: '0', diasCredito: '0',
};

export function Contactos({ tipo }: { tipo: 'clientes' | 'proveedores' }) {
  const esCliente = tipo === 'clientes';
  const avisos = useAvisos();
  const [datos, setDatos] = useState<Contacto[]>([]);
  const [texto, setTexto] = useState('');
  const [conSaldo, setConSaldo] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [formulario, setFormulario] = useState<typeof VACIO | null>(null);
  const [editando, setEditando] = useState<Contacto | null>(null);
  const [detalle, setDetalle] = useState<any | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await api.get<{ datos: Contacto[] }>(
        `/${tipo}${consulta({ texto, conSaldo: conSaldo || undefined, soloActivos: 'false', porPagina: 300 })}`,
      );
      setDatos(r.datos);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setCargando(false);
    }
  }, [tipo, texto, conSaldo]);

  useEffect(() => { void cargar(); }, [cargar]);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!formulario) return;
    const cuerpo: Record<string, unknown> = {
      tipoDocumento: formulario.tipoDocumento,
      documento: formulario.documento.trim(),
      nombre: formulario.nombre.trim(),
      email: formulario.email.trim(),
      telefono: formulario.telefono.trim(),
      direccion: formulario.direccion.trim(),
    };
    if (esCliente) {
      cuerpo.limiteCreditoUsd = Number(formulario.limiteCreditoUsd) || 0;
      cuerpo.diasCredito = Number(formulario.diasCredito) || 0;
    }
    try {
      if (editando) {
        await api.put(`/${tipo}/${editando.id}`, cuerpo);
        avisos.exito('Registro actualizado');
      } else {
        await api.post(`/${tipo}`, cuerpo);
        avisos.exito('Registro creado');
      }
      setFormulario(null);
      setEditando(null);
      void cargar();
    } catch (err) {
      avisos.error((err as Error).message);
    }
  }

  const titulo = esCliente ? 'Clientes' : 'Proveedores';

  return (
    <div className="pila">
      <Tarjeta
        titulo={titulo}
        acciones={
          <div className="fila">
            <input placeholder="Buscar por nombre o documento…" value={texto} onChange={(e) => setTexto(e.target.value)} style={{ width: 240 }} />
            <label className="fila" style={{ gap: 6 }}>
              <input type="checkbox" checked={conSaldo} onChange={(e) => setConSaldo(e.target.checked)} />
              <span className="pequeno">Solo con saldo</span>
            </label>
            <button
              className="boton boton--primario boton--chico"
              onClick={() => { setEditando(null); setFormulario({ ...VACIO, tipoDocumento: esCliente ? 'V' : 'J' }); }}
            >
              + Nuevo
            </button>
          </div>
        }
        pegado
      >
        {cargando ? <Cargando /> : (
          <Tabla
            columnas={[
              { titulo: 'Nombre' }, { titulo: 'Documento' }, { titulo: 'Contacto' },
              ...(esCliente ? [{ titulo: 'Credito', num: true }] : []),
              { titulo: 'Saldo', num: true }, { titulo: '' },
            ]}
            vacia="No hay registros"
          >
            {datos.map((c) => (
              <tr key={c.id}>
                <td>
                  <div className="fuerte">{c.nombre} {!c.activo && <Pastilla>inactivo</Pastilla>}</div>
                  <div className="pequeno tenue">{c.direccion || '—'}</div>
                </td>
                <td className="mono">{c.tipo_documento}-{c.documento}</td>
                <td className="pequeno">
                  {c.telefono || '—'}
                  {c.email && <div className="tenue">{c.email}</div>}
                </td>
                {esCliente && (
                  <td className="num tenue">
                    {Number(c.limite_credito_usd) > 0 ? `${usd(c.limite_credito_usd)} · ${c.dias_credito}d` : 'sin limite'}
                  </td>
                )}
                <td className="num">
                  {Number(c.saldo_usd) > 0 ? <Pastilla tono="aviso">{usd(c.saldo_usd)}</Pastilla> : <span className="tenue">—</span>}
                </td>
                <td className="apretado">
                  <button className="boton boton--neutro boton--chico" onClick={async () => setDetalle(await api.get(`/${tipo}/${c.id}`))}>Ver</button>{' '}
                  <button
                    className="boton boton--fantasma boton--chico"
                    onClick={() => {
                      setEditando(c);
                      setFormulario({
                        tipoDocumento: c.tipo_documento, documento: c.documento, nombre: c.nombre,
                        email: c.email, telefono: c.telefono, direccion: c.direccion,
                        limiteCreditoUsd: String(c.limite_credito_usd ?? 0), diasCredito: String(c.dias_credito ?? 0),
                      });
                    }}
                  >Editar</button>
                </td>
              </tr>
            ))}
          </Tabla>
        )}
      </Tarjeta>

      <AvisoError error={error} />

      {formulario && (
        <Modal
          titulo={editando ? `Editar ${editando.nombre}` : `Nuevo ${esCliente ? 'cliente' : 'proveedor'}`}
          alCerrar={() => { setFormulario(null); setEditando(null); }}
          pie={
            <>
              <button className="boton boton--neutro" onClick={() => { setFormulario(null); setEditando(null); }}>Cancelar</button>
              <button className="boton boton--primario" form="form-contacto">Guardar</button>
            </>
          }
        >
          <form id="form-contacto" onSubmit={guardar} className="pila pila--corta">
            <div className="fila">
              <Campo etiqueta="Tipo">
                <select value={formulario.tipoDocumento} onChange={(e) => setFormulario({ ...formulario, tipoDocumento: e.target.value })}>
                  {['V', 'E', 'J', 'G', 'P'].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Campo>
              <Campo etiqueta="Documento">
                <input required value={formulario.documento} onChange={(e) => setFormulario({ ...formulario, documento: e.target.value })} />
              </Campo>
              <Campo etiqueta="Nombre o razon social">
                <input required value={formulario.nombre} onChange={(e) => setFormulario({ ...formulario, nombre: e.target.value })} />
              </Campo>
            </div>
            <div className="fila">
              <Campo etiqueta="Telefono"><input value={formulario.telefono} onChange={(e) => setFormulario({ ...formulario, telefono: e.target.value })} /></Campo>
              <Campo etiqueta="Correo"><input type="email" value={formulario.email} onChange={(e) => setFormulario({ ...formulario, email: e.target.value })} /></Campo>
            </div>
            <Campo etiqueta="Direccion">
              <input value={formulario.direccion} onChange={(e) => setFormulario({ ...formulario, direccion: e.target.value })} />
            </Campo>
            {esCliente && (
              <div className="fila">
                <Campo etiqueta="Limite de credito USD" ayuda="0 = sin limite">
                  <input className="numerico" type="number" step="0.01" min="0" value={formulario.limiteCreditoUsd}
                    onChange={(e) => setFormulario({ ...formulario, limiteCreditoUsd: e.target.value })} />
                </Campo>
                <Campo etiqueta="Dias de credito">
                  <input className="numerico" type="number" min="0" value={formulario.diasCredito}
                    onChange={(e) => setFormulario({ ...formulario, diasCredito: e.target.value })} />
                </Campo>
              </div>
            )}
          </form>
        </Modal>
      )}

      {detalle && (
        <Modal ancho titulo={detalle.nombre} alCerrar={() => setDetalle(null)}
          pie={<button className="boton boton--neutro" onClick={() => setDetalle(null)}>Cerrar</button>}>
          <div className="pila">
            <div className="rejilla rejilla--4">
              <div><div className="campo__etiqueta">Documento</div><div className="mono">{detalle.tipo_documento}-{detalle.documento}</div></div>
              <div><div className="campo__etiqueta">Telefono</div><div>{detalle.telefono || '—'}</div></div>
              <div><div className="campo__etiqueta">Correo</div><div>{detalle.email || '—'}</div></div>
              <div><div className="campo__etiqueta">Saldo</div><div className="fuerte">{usd(detalle.saldo_usd)}</div></div>
            </div>
            <Tabla
              columnas={[{ titulo: 'Documento' }, { titulo: 'Fecha' }, { titulo: 'Condicion' }, { titulo: 'Total', num: true }, { titulo: 'Saldo', num: true }, { titulo: 'Estado' }]}
              vacia="Sin movimientos"
            >
              {detalle.documentos.map((d: any) => (
                <tr key={d.id}>
                  <td className="mono fuerte">{d.numero}</td>
                  <td className="apretado">{fecha(d.fecha)}</td>
                  <td>{d.condicion}</td>
                  <td className="num">{usd(d.total_usd)}</td>
                  <td className="num">{Number(d.saldo_usd) > 0 ? usd(d.saldo_usd) : '—'}</td>
                  <td><Pastilla tono={d.estado === 'ANULADA' ? 'peligro' : 'exito'}>{d.estado}</Pastilla></td>
                </tr>
              ))}
            </Tabla>
          </div>
        </Modal>
      )}
    </div>
  );
}
