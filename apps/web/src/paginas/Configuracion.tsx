import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useAvisos } from '../lib/avisos';
import { esAdministrador, useSesion } from '../lib/sesion';
import { bs, fecha, fechaHora, hoyIso, numero } from '../lib/formato';
import { AvisoError, Campo, Modal, Pastilla, Tabla, Tarjeta } from '../componentes/ui';

interface Sucursal { id: number; codigo: string; nombre: string; direccion: string; es_principal: boolean; activa: boolean }
interface Usuario { id: number; email: string; nombre: string; rol: string; sucursal: string | null; activo: boolean; ultimo_acceso: string | null }
interface MetodoPago { codigo: string; nombre: string; moneda: string; aplica_igtf: boolean; activo: boolean }

const ROLES = ['PROPIETARIO', 'ADMIN', 'VENDEDOR', 'ALMACEN', 'CONTADOR'];

export function Configuracion() {
  const { usuario, organizacion, recargarOrganizacion } = useSesion();
  const avisos = useAvisos();
  const admin = esAdministrador(usuario?.rol as any);

  const [org, setOrg] = useState({ nombre: '', rif: '', direccion: '', telefono: '', email: '', ivaTasa: '16', igtfTasa: '3' });
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [metodos, setMetodos] = useState<MetodoPago[]>([]);
  const [categorias, setCategorias] = useState<Array<{ id: number; nombre: string }>>([]);
  const [tasa, setTasa] = useState<{ valor: number; fecha: string; fuente: string } | null>(null);
  const [historico, setHistorico] = useState<Array<{ fecha: string; valor: number; fuente: string }>>([]);
  const [nuevaTasa, setNuevaTasa] = useState({ fecha: hoyIso(), valor: '' });
  const [error, setError] = useState<unknown>(null);

  const [nuevoUsuario, setNuevoUsuario] = useState<{ email: string; nombre: string; password: string; rol: string; sucursalId: number | '' } | null>(null);
  const [nuevaSucursal, setNuevaSucursal] = useState<{ codigo: string; nombre: string; direccion: string } | null>(null);
  const [nuevaCategoria, setNuevaCategoria] = useState('');
  const [clave, setClave] = useState({ actual: '', nueva: '' });

  async function cargar() {
    try {
      const [s, m, c, t, h] = await Promise.all([
        api.get<{ datos: Sucursal[] }>('/configuracion/sucursales'),
        api.get<{ datos: MetodoPago[] }>('/configuracion/metodos-pago'),
        api.get<{ datos: Array<{ id: number; nombre: string }> }>('/configuracion/categorias'),
        api.get<{ valor: number; fecha: string; fuente: string }>('/configuracion/tasa'),
        api.get<{ datos: Array<{ fecha: string; valor: number; fuente: string }> }>('/configuracion/tasa/historico'),
      ]);
      setSucursales(s.datos);
      setMetodos(m.datos);
      setCategorias(c.datos);
      setTasa(t);
      setHistorico(h.datos);
      if (admin) setUsuarios((await api.get<{ datos: Usuario[] }>('/configuracion/usuarios')).datos);
    } catch (e) {
      setError(e);
    }
  }

  useEffect(() => { void cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [admin]);

  useEffect(() => {
    if (organizacion) {
      setOrg({
        nombre: organizacion.nombre, rif: organizacion.rif, direccion: organizacion.direccion,
        telefono: organizacion.telefono, email: organizacion.email,
        ivaTasa: String(organizacion.iva_tasa), igtfTasa: String(organizacion.igtf_tasa),
      });
    }
  }, [organizacion]);

  async function guardarOrg(e: FormEvent) {
    e.preventDefault();
    try {
      await api.put('/configuracion/organizacion', {
        nombre: org.nombre, rif: org.rif, direccion: org.direccion, telefono: org.telefono,
        email: org.email, ivaTasa: Number(org.ivaTasa), igtfTasa: Number(org.igtfTasa),
      });
      await recargarOrganizacion();
      avisos.exito('Datos de la empresa actualizados');
    } catch (err) {
      avisos.error((err as Error).message);
    }
  }

  async function guardarTasa(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post('/configuracion/tasa', { fecha: nuevaTasa.fecha, valor: Number(nuevaTasa.valor) });
      setNuevaTasa({ fecha: hoyIso(), valor: '' });
      avisos.exito('Tasa actualizada');
      void cargar();
    } catch (err) {
      avisos.error((err as Error).message);
    }
  }

  async function crearUsuario(e: FormEvent) {
    e.preventDefault();
    if (!nuevoUsuario) return;
    try {
      await api.post('/configuracion/usuarios', {
        ...nuevoUsuario,
        sucursalId: nuevoUsuario.sucursalId || null,
      });
      setNuevoUsuario(null);
      avisos.exito('Usuario creado');
      void cargar();
    } catch (err) {
      avisos.error((err as Error).message);
    }
  }

  async function alternarUsuario(u: Usuario) {
    try {
      await api.put(`/configuracion/usuarios/${u.id}`, { activo: !u.activo });
      void cargar();
    } catch (err) {
      avisos.error((err as Error).message);
    }
  }

  async function crearSucursal(e: FormEvent) {
    e.preventDefault();
    if (!nuevaSucursal) return;
    try {
      await api.post('/configuracion/sucursales', nuevaSucursal);
      setNuevaSucursal(null);
      avisos.exito('Sucursal creada');
      void cargar();
    } catch (err) {
      avisos.error((err as Error).message);
    }
  }

  async function crearCategoria(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post('/configuracion/categorias', { nombre: nuevaCategoria });
      setNuevaCategoria('');
      avisos.exito('Categoria creada');
      void cargar();
    } catch (err) {
      avisos.error((err as Error).message);
    }
  }

  async function cambiarClave(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post('/auth/cambiar-clave', clave);
      setClave({ actual: '', nueva: '' });
      avisos.exito('Clave actualizada');
    } catch (err) {
      avisos.error((err as Error).message);
    }
  }

  return (
    <div className="pila">
      <AvisoError error={error} />

      <div className="rejilla rejilla--2">
        <Tarjeta titulo="Tasa de cambio">
          <div className="pila pila--corta">
            <div className="fila fila--entre">
              <div>
                <div className="campo__etiqueta">Vigente</div>
                <div className="kpi__valor">{tasa ? bs(tasa.valor) : '—'}</div>
                <div className="pequeno tenue">{tasa ? `${fecha(tasa.fecha)} · ${tasa.fuente.toLowerCase()}` : ''}</div>
              </div>
            </div>
            <form onSubmit={guardarTasa} className="fila">
              <Campo etiqueta="Fecha">
                <input type="date" value={nuevaTasa.fecha} onChange={(e) => setNuevaTasa({ ...nuevaTasa, fecha: e.target.value })} />
              </Campo>
              <Campo etiqueta="Bs por dolar">
                <input className="numerico" type="number" step="0.0001" min="0" required placeholder="36.5000"
                  value={nuevaTasa.valor} onChange={(e) => setNuevaTasa({ ...nuevaTasa, valor: e.target.value })} />
              </Campo>
              <Campo etiqueta="&nbsp;"><button className="boton boton--primario">Guardar</button></Campo>
            </form>
            <div className="separador" />
            <Tabla columnas={[{ titulo: 'Fecha' }, { titulo: 'Tasa', num: true }, { titulo: 'Fuente' }]} vacia="Sin historico">
              {historico.slice(0, 8).map((h) => (
                <tr key={h.fecha}>
                  <td>{fecha(h.fecha)}</td>
                  <td className="num fuerte">{numero(h.valor)}</td>
                  <td className="tenue pequeno">{h.fuente}</td>
                </tr>
              ))}
            </Tabla>
          </div>
        </Tarjeta>

        <Tarjeta titulo="Datos de la empresa">
          <form onSubmit={guardarOrg} className="pila pila--corta">
            <div className="fila">
              <Campo etiqueta="Razon social"><input value={org.nombre} onChange={(e) => setOrg({ ...org, nombre: e.target.value })} disabled={!admin} /></Campo>
              <Campo etiqueta="RIF"><input value={org.rif} onChange={(e) => setOrg({ ...org, rif: e.target.value })} disabled={!admin} /></Campo>
            </div>
            <Campo etiqueta="Direccion fiscal"><input value={org.direccion} onChange={(e) => setOrg({ ...org, direccion: e.target.value })} disabled={!admin} /></Campo>
            <div className="fila">
              <Campo etiqueta="Telefono"><input value={org.telefono} onChange={(e) => setOrg({ ...org, telefono: e.target.value })} disabled={!admin} /></Campo>
              <Campo etiqueta="Correo"><input value={org.email} onChange={(e) => setOrg({ ...org, email: e.target.value })} disabled={!admin} /></Campo>
            </div>
            <div className="fila">
              <Campo etiqueta="IVA %" ayuda="Alicuota general por defecto">
                <input className="numerico" type="number" step="0.01" value={org.ivaTasa} onChange={(e) => setOrg({ ...org, ivaTasa: e.target.value })} disabled={!admin} />
              </Campo>
              <Campo etiqueta="IGTF %" ayuda="Aplica a cobros en divisa">
                <input className="numerico" type="number" step="0.01" value={org.igtfTasa} onChange={(e) => setOrg({ ...org, igtfTasa: e.target.value })} disabled={!admin} />
              </Campo>
            </div>
            {admin && <button className="boton boton--primario">Guardar cambios</button>}
          </form>
        </Tarjeta>
      </div>

      <div className="rejilla rejilla--2">
        <Tarjeta
          titulo="Sucursales y almacenes"
          acciones={admin && <button className="boton boton--neutro boton--chico" onClick={() => setNuevaSucursal({ codigo: '', nombre: '', direccion: '' })}>+ Nueva</button>}
          pegado
        >
          <Tabla columnas={[{ titulo: 'Codigo' }, { titulo: 'Nombre' }, { titulo: 'Estado' }]}>
            {sucursales.map((s) => (
              <tr key={s.id}>
                <td className="mono">{s.codigo}</td>
                <td className="fuerte">{s.nombre} {s.es_principal && <Pastilla tono="marca">principal</Pastilla>}</td>
                <td><Pastilla tono={s.activa ? 'exito' : 'neutra'}>{s.activa ? 'activa' : 'inactiva'}</Pastilla></td>
              </tr>
            ))}
          </Tabla>
        </Tarjeta>

        <Tarjeta titulo="Metodos de pago" pegado>
          <Tabla columnas={[{ titulo: 'Metodo' }, { titulo: 'Moneda' }, { titulo: 'IGTF' }]}>
            {metodos.map((m) => (
              <tr key={m.codigo}>
                <td className="fuerte">{m.nombre}</td>
                <td><Pastilla tono={m.moneda === 'USD' ? 'marca' : 'info'}>{m.moneda}</Pastilla></td>
                <td>{m.aplica_igtf ? <Pastilla tono="aviso">grava 3%</Pastilla> : <span className="tenue">exento</span>}</td>
              </tr>
            ))}
          </Tabla>
        </Tarjeta>
      </div>

      <div className="rejilla rejilla--2">
        <Tarjeta titulo="Categorias de productos">
          <form onSubmit={crearCategoria} className="fila">
            <div className="crecer">
              <Campo><input value={nuevaCategoria} onChange={(e) => setNuevaCategoria(e.target.value)} placeholder="Nombre de la categoria" /></Campo>
            </div>
            <button className="boton boton--primario" disabled={!nuevaCategoria.trim()}>Agregar</button>
          </form>
          <div className="fila" style={{ marginTop: 12 }}>
            {categorias.map((c) => <Pastilla key={c.id}>{c.nombre}</Pastilla>)}
          </div>
        </Tarjeta>

        <Tarjeta titulo="Cambiar mi clave">
          <form onSubmit={cambiarClave} className="pila pila--corta">
            <Campo etiqueta="Clave actual">
              <input type="password" required value={clave.actual} onChange={(e) => setClave({ ...clave, actual: e.target.value })} />
            </Campo>
            <Campo etiqueta="Clave nueva" ayuda="Minimo 8 caracteres">
              <input type="password" required minLength={8} value={clave.nueva} onChange={(e) => setClave({ ...clave, nueva: e.target.value })} />
            </Campo>
            <button className="boton boton--primario">Actualizar clave</button>
          </form>
        </Tarjeta>
      </div>

      {admin && (
        <Tarjeta
          titulo="Usuarios del sistema"
          acciones={<button className="boton boton--primario boton--chico" onClick={() => setNuevoUsuario({ email: '', nombre: '', password: '', rol: 'VENDEDOR', sucursalId: '' })}>+ Nuevo usuario</button>}
          pegado
        >
          <Tabla columnas={[{ titulo: 'Nombre' }, { titulo: 'Correo' }, { titulo: 'Rol' }, { titulo: 'Sucursal' }, { titulo: 'Ultimo acceso' }, { titulo: '' }]}>
            {usuarios.map((u) => (
              <tr key={u.id}>
                <td className="fuerte">{u.nombre}</td>
                <td className="mono pequeno">{u.email}</td>
                <td><Pastilla tono={u.rol === 'PROPIETARIO' ? 'marca' : 'neutra'}>{u.rol}</Pastilla></td>
                <td className="tenue">{u.sucursal ?? '—'}</td>
                <td className="pequeno tenue">{u.ultimo_acceso ? fechaHora(u.ultimo_acceso) : 'nunca'}</td>
                <td>
                  {u.id !== usuario?.id && (
                    <button className="boton boton--neutro boton--chico" onClick={() => alternarUsuario(u)}>
                      {u.activo ? 'Desactivar' : 'Activar'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Tabla>
        </Tarjeta>
      )}

      {nuevoUsuario && (
        <Modal
          titulo="Nuevo usuario"
          alCerrar={() => setNuevoUsuario(null)}
          pie={
            <>
              <button className="boton boton--neutro" onClick={() => setNuevoUsuario(null)}>Cancelar</button>
              <button className="boton boton--primario" form="form-usuario">Crear</button>
            </>
          }
        >
          <form id="form-usuario" onSubmit={crearUsuario} className="pila pila--corta">
            <Campo etiqueta="Nombre"><input required value={nuevoUsuario.nombre} onChange={(e) => setNuevoUsuario({ ...nuevoUsuario, nombre: e.target.value })} /></Campo>
            <Campo etiqueta="Correo"><input type="email" required value={nuevoUsuario.email} onChange={(e) => setNuevoUsuario({ ...nuevoUsuario, email: e.target.value })} /></Campo>
            <Campo etiqueta="Clave" ayuda="Minimo 8 caracteres">
              <input type="password" required minLength={8} value={nuevoUsuario.password} onChange={(e) => setNuevoUsuario({ ...nuevoUsuario, password: e.target.value })} />
            </Campo>
            <div className="fila">
              <Campo etiqueta="Rol">
                <select value={nuevoUsuario.rol} onChange={(e) => setNuevoUsuario({ ...nuevoUsuario, rol: e.target.value })}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </Campo>
              <Campo etiqueta="Sucursal">
                <select value={nuevoUsuario.sucursalId} onChange={(e) => setNuevoUsuario({ ...nuevoUsuario, sucursalId: e.target.value ? Number(e.target.value) : '' })}>
                  <option value="">Sin asignar</option>
                  {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </Campo>
            </div>
            <div className="aviso aviso--info">
              PROPIETARIO y ADMIN pueden anular documentos y gestionar usuarios. VENDEDOR factura,
              ALMACEN mueve inventario y CONTADOR registra cobros y la tasa.
            </div>
          </form>
        </Modal>
      )}

      {nuevaSucursal && (
        <Modal
          titulo="Nueva sucursal o almacen"
          alCerrar={() => setNuevaSucursal(null)}
          pie={
            <>
              <button className="boton boton--neutro" onClick={() => setNuevaSucursal(null)}>Cancelar</button>
              <button className="boton boton--primario" form="form-sucursal">Crear</button>
            </>
          }
        >
          <form id="form-sucursal" onSubmit={crearSucursal} className="pila pila--corta">
            <div className="fila">
              <Campo etiqueta="Codigo"><input required value={nuevaSucursal.codigo} onChange={(e) => setNuevaSucursal({ ...nuevaSucursal, codigo: e.target.value })} /></Campo>
              <Campo etiqueta="Nombre"><input required value={nuevaSucursal.nombre} onChange={(e) => setNuevaSucursal({ ...nuevaSucursal, nombre: e.target.value })} /></Campo>
            </div>
            <Campo etiqueta="Direccion"><input value={nuevaSucursal.direccion} onChange={(e) => setNuevaSucursal({ ...nuevaSucursal, direccion: e.target.value })} /></Campo>
          </form>
        </Modal>
      )}
    </div>
  );
}
