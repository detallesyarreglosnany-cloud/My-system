import { useEffect, type ReactNode } from 'react';
import { ErrorApi } from '../lib/api';

export function Tarjeta({ titulo, acciones, children, pegado, pie }: {
  titulo?: ReactNode; acciones?: ReactNode; children: ReactNode; pegado?: boolean; pie?: ReactNode;
}) {
  return (
    <section className="tarjeta">
      {(titulo || acciones) && (
        <header className="tarjeta__cabecera">
          <div className="crecer">{typeof titulo === 'string' ? <h2>{titulo}</h2> : titulo}</div>
          {acciones}
        </header>
      )}
      <div className={pegado ? 'tarjeta__cuerpo tarjeta__cuerpo--pegado' : 'tarjeta__cuerpo'}>{children}</div>
      {pie}
    </section>
  );
}

export function Kpi({ etiqueta, valor, nota, tono }: {
  etiqueta: string; valor: ReactNode; nota?: ReactNode; tono?: 'acento' | 'peligro' | 'aviso' | 'exito';
}) {
  return (
    <div className={`tarjeta kpi${tono ? ` kpi--${tono}` : ''}`}>
      <div className="kpi__etiqueta">{etiqueta}</div>
      <div className="kpi__valor">{valor}</div>
      {nota != null && <div className="kpi__nota">{nota}</div>}
    </div>
  );
}

export function Campo({ etiqueta, ayuda, error, children }: {
  etiqueta?: string; ayuda?: string; error?: string; children: ReactNode;
}) {
  return (
    <label className="campo">
      {etiqueta && <span className="campo__etiqueta">{etiqueta}</span>}
      {children}
      {ayuda && !error && <span className="campo__ayuda">{ayuda}</span>}
      {error && <span className="campo__error">{error}</span>}
    </label>
  );
}

export function Aviso({ tono = 'info', children }: { tono?: 'error' | 'exito' | 'info' | 'aviso'; children: ReactNode }) {
  return <div className={`aviso aviso--${tono}`}>{children}</div>;
}

/** Muestra un error de la API con sus detalles de validacion. */
export function AvisoError({ error }: { error: unknown }) {
  if (!error) return null;
  const mensaje = error instanceof ErrorApi ? error.message : (error as Error)?.message ?? 'Ocurrio un error';
  const detalles = error instanceof ErrorApi && Array.isArray(error.detalles) ? (error.detalles as any[]) : [];
  return (
    <div className="aviso aviso--error">
      <div>
        <strong>{mensaje}</strong>
        {detalles.length > 0 && (
          <ul className="aviso__lista">
            {detalles.map((d, i) => (
              <li key={i}>{d.campo ? `${d.campo}: ${d.mensaje}` : d.mensaje ?? String(d)}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function Pastilla({ tono = 'neutra', children }: {
  tono?: 'neutra' | 'exito' | 'aviso' | 'peligro' | 'info' | 'marca'; children: ReactNode;
}) {
  return <span className={`pastilla pastilla--${tono}`}>{children}</span>;
}

export function Modal({ titulo, ancho, children, pie, alCerrar }: {
  titulo: ReactNode; ancho?: boolean; children: ReactNode; pie?: ReactNode; alCerrar: () => void;
}) {
  useEffect(() => {
    const alTecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') alCerrar();
    };
    window.addEventListener('keydown', alTecla);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', alTecla);
      document.body.style.overflow = '';
    };
  }, [alCerrar]);

  return (
    <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && alCerrar()}>
      <div className={ancho ? 'modal modal--ancho' : 'modal'} role="dialog" aria-modal="true">
        <header className="modal__cabecera">
          <div className="crecer">{typeof titulo === 'string' ? <h2>{titulo}</h2> : titulo}</div>
          <button className="boton boton--fantasma boton--chico" onClick={alCerrar} aria-label="Cerrar">✕</button>
        </header>
        <div className="modal__cuerpo">{children}</div>
        {pie && <footer className="modal__pie">{pie}</footer>}
      </div>
    </div>
  );
}

export function Tabla({ columnas, children, vacia }: {
  columnas: Array<{ titulo: ReactNode; num?: boolean; ancho?: string }>;
  children: ReactNode;
  vacia?: string;
}) {
  const sinFilas = Array.isArray(children) ? children.flat().filter(Boolean).length === 0 : !children;
  return (
    <div className="tabla-marco">
      <table className="tabla">
        <thead>
          <tr>
            {columnas.map((c, i) => (
              <th key={i} className={c.num ? 'num' : undefined} style={c.ancho ? { width: c.ancho } : undefined}>
                {c.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sinFilas ? (
            <tr>
              <td colSpan={columnas.length} className="tabla__vacia">
                {vacia ?? 'Sin registros'}
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return <div className="cargando">{texto}</div>;
}

/** Grafico de barras en HTML puro: sin librerias, legible en claro y oscuro. */
export function Barras({ datos, formato }: {
  datos: Array<{ etiqueta: string; valor: number }>;
  formato: (v: number) => string;
}) {
  const maximo = Math.max(...datos.map((d) => d.valor), 0);
  if (maximo <= 0) {
    return (
      <div className="barras" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <span className="tenue">Sin movimientos en el periodo</span>
      </div>
    );
  }
  return (
    <div>
      <div className="barras">
        {datos.map((d, i) => (
          <div className="barras__col" key={i} title={`${d.etiqueta}: ${formato(d.valor)}`}>
            <div className="barras__barra" style={{ height: `${Math.max((d.valor / maximo) * 100, 1)}%` }} />
          </div>
        ))}
      </div>
      <div className="barras__ejes">
        <span>{datos[0]?.etiqueta}</span>
        <span className="fuerte">max {formato(maximo)}</span>
        <span>{datos[datos.length - 1]?.etiqueta}</span>
      </div>
    </div>
  );
}

export function ControlCantidad({ valor, alCambiar, minimo = 1 }: {
  valor: number; alCambiar: (v: number) => void; minimo?: number;
}) {
  return (
    <span className="cantidad-control">
      <button type="button" onClick={() => alCambiar(Math.max(valor - 1, minimo))} aria-label="Restar">−</button>
      <input
        type="number"
        value={valor}
        min={minimo}
        step="any"
        onChange={(e) => alCambiar(Math.max(Number(e.target.value) || minimo, minimo))}
      />
      <button type="button" onClick={() => alCambiar(valor + 1)} aria-label="Sumar">+</button>
    </span>
  );
}
