import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { api } from '../lib/api';
import { useSesion } from '../lib/sesion';
import { bs, usd } from '../lib/formato';

interface Entrada {
  ruta: string;
  etiqueta: string;
  icono: string;
  grupo: string;
}

const MENU: Entrada[] = [
  { ruta: '/', etiqueta: 'Panel', icono: '◧', grupo: 'Hoy' },
  { ruta: '/vender', etiqueta: 'Punto de venta', icono: '▤', grupo: 'Hoy' },
  { ruta: '/asistente', etiqueta: 'Asistente', icono: '✦', grupo: 'Hoy' },
  { ruta: '/ventas', etiqueta: 'Ventas', icono: '↗', grupo: 'Operacion' },
  { ruta: '/compras', etiqueta: 'Compras', icono: '↘', grupo: 'Operacion' },
  { ruta: '/inventario', etiqueta: 'Inventario', icono: '▦', grupo: 'Operacion' },
  { ruta: '/cuentas', etiqueta: 'Cuentas', icono: '≡', grupo: 'Operacion' },
  { ruta: '/clientes', etiqueta: 'Clientes', icono: '☺', grupo: 'Directorio' },
  { ruta: '/proveedores', etiqueta: 'Proveedores', icono: '⌂', grupo: 'Directorio' },
  { ruta: '/reportes', etiqueta: 'Reportes', icono: '◐', grupo: 'Analisis' },
  { ruta: '/configuracion', etiqueta: 'Configuracion', icono: '⚙', grupo: 'Analisis' },
];

const TITULOS: Record<string, string> = {
  '/': 'Panel de control',
  '/vender': 'Punto de venta',
  '/ventas': 'Ventas',
  '/compras': 'Compras',
  '/inventario': 'Inventario',
  '/cuentas': 'Cuentas por cobrar y pagar',
  '/clientes': 'Clientes',
  '/proveedores': 'Proveedores',
  '/reportes': 'Reportes',
  '/asistente': 'Asistente',
  '/configuracion': 'Configuracion',
};

export function Layout({ children }: { children: ReactNode }) {
  const { usuario, organizacion, salir } = useSesion();
  const ubicacion = useLocation();
  const [abierto, setAbierto] = useState(false);
  const [tasa, setTasa] = useState<{ valor: number; fecha: string } | null>(null);
  const [alertas, setAlertas] = useState(0);

  useEffect(() => {
    setAbierto(false);
  }, [ubicacion.pathname]);

  useEffect(() => {
    let vivo = true;
    const cargar = async () => {
      try {
        const [t, r] = await Promise.all([
          api.get<{ valor: number; fecha: string }>('/configuracion/tasa'),
          api.get<{ inventario: { alertas_stock_bajo: number } }>('/reportes/resumen'),
        ]);
        if (!vivo) return;
        setTasa(t);
        setAlertas(r.inventario.alertas_stock_bajo);
      } catch {
        /* la vista sigue siendo usable sin estos datos */
      }
    };
    void cargar();
    const id = setInterval(cargar, 60_000);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, [ubicacion.pathname]);

  const grupos = [...new Set(MENU.map((m) => m.grupo))];

  return (
    <div className="app">
      <aside className={abierto ? 'lateral lateral--abierto' : 'lateral'}>
        <div className="lateral__marca">
          <div className="lateral__logo">F</div>
          <div className="crecer">
            <div className="lateral__nombre">{organizacion?.nombre ?? 'Fina Local'}</div>
            <div className="lateral__rif">{organizacion?.rif ?? '—'}</div>
          </div>
        </div>

        <nav className="lateral__nav">
          {grupos.map((grupo) => (
            <div key={grupo}>
              <div className="lateral__grupo">{grupo}</div>
              {MENU.filter((m) => m.grupo === grupo).map((m) => (
                <NavLink
                  key={m.ruta}
                  to={m.ruta}
                  end={m.ruta === '/'}
                  className={({ isActive }) => (isActive ? 'nav-enlace nav-enlace--activo' : 'nav-enlace')}
                >
                  <span className="nav-enlace__icono" aria-hidden>{m.icono}</span>
                  <span>{m.etiqueta}</span>
                  {m.ruta === '/inventario' && alertas > 0 && (
                    <span className="nav-enlace__contador">{alertas}</span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="lateral__pie">
          <div className="fuerte">{usuario?.nombre}</div>
          <div className="pequeno tenue" style={{ marginBottom: 8 }}>
            {usuario?.rol.toLowerCase()} · {usuario?.email}
          </div>
          <button className="boton boton--neutro boton--bloque boton--chico" onClick={salir}>
            Cerrar sesion
          </button>
        </div>
      </aside>

      <div className="principal">
        <header className="barra">
          <button
            className="boton boton--neutro boton--chico alternar-menu"
            onClick={() => setAbierto((v) => !v)}
            aria-label="Menu"
          >
            ☰
          </button>
          <div className="barra__titulo">
            <h1>{TITULOS[ubicacion.pathname] ?? 'Fina Local'}</h1>
            <div className="barra__sub">
              {new Date().toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
          </div>
          {tasa && (
            <div className="derecha oculto-movil">
              <div className="pequeno tenue">Tasa del dia</div>
              <div className="fuerte num">{bs(tasa.valor)} / {usd(1)}</div>
            </div>
          )}
        </header>
        <main className="contenido">{children}</main>
      </div>
    </div>
  );
}
