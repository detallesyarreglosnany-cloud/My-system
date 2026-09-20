import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type Tono = 'exito' | 'error' | 'info';
interface Aviso { id: number; texto: string; tono: Tono; }

const Contexto = createContext<{
  exito: (t: string) => void;
  error: (t: string) => void;
  info: (t: string) => void;
} | null>(null);

export function ProveedorAvisos({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);

  const mostrar = useCallback((texto: string, tono: Tono) => {
    const id = Date.now() + Math.random();
    setAvisos((previos) => [...previos, { id, texto, tono }]);
    setTimeout(() => setAvisos((previos) => previos.filter((a) => a.id !== id)), tono === 'error' ? 6500 : 3800);
  }, []);

  const valor = useMemo(
    () => ({
      exito: (t: string) => mostrar(t, 'exito'),
      error: (t: string) => mostrar(t, 'error'),
      info: (t: string) => mostrar(t, 'info'),
    }),
    [mostrar],
  );

  return (
    <Contexto.Provider value={valor}>
      {children}
      <div className="avisos-flotantes" role="status" aria-live="polite">
        {avisos.map((a) => (
          <div key={a.id} className={`aviso-flotante aviso-flotante--${a.tono}`}>
            {a.texto}
          </div>
        ))}
      </div>
    </Contexto.Provider>
  );
}

export function useAvisos() {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error('useAvisos debe usarse dentro de ProveedorAvisos');
  return ctx;
}
