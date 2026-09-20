import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { Campo, Pastilla, Tarjeta } from '../componentes/ui';

interface Mensaje { autor: 'usuario' | 'asistente'; texto: string; intencion?: string; motor?: string }

export function Asistente() {
  const [mensajes, setMensajes] = useState<Mensaje[]>([
    {
      autor: 'asistente',
      texto:
        'Hola. Pregúntame lo que quieras sobre tu negocio: ventas, utilidad, inventario, ' +
        'cuentas por cobrar, precios o la tasa del día. Respondo con los datos reales de tu sistema.',
    },
  ]);
  const [pregunta, setPregunta] = useState('');
  const [sugerencias, setSugerencias] = useState<string[]>([]);
  const [pensando, setPensando] = useState(false);
  const finRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get<{ datos: string[] }>('/asistente/sugerencias').then((r) => setSugerencias(r.datos)).catch(() => {});
  }, []);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensajes]);

  async function enviar(texto: string) {
    const limpio = texto.trim();
    if (!limpio || pensando) return;
    setMensajes((m) => [...m, { autor: 'usuario', texto: limpio }]);
    setPregunta('');
    setPensando(true);
    try {
      const r = await api.post<{ respuesta: string; intencion: string; motor: string }>('/asistente/preguntar', { pregunta: limpio });
      setMensajes((m) => [...m, { autor: 'asistente', texto: r.respuesta, intencion: r.intencion, motor: r.motor }]);
    } catch (e) {
      setMensajes((m) => [...m, { autor: 'asistente', texto: `No pude responder: ${(e as Error).message}` }]);
    } finally {
      setPensando(false);
    }
  }

  function enviarFormulario(e: FormEvent) {
    e.preventDefault();
    void enviar(pregunta);
  }

  return (
    <div className="rejilla" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
      <Tarjeta
        titulo="Asistente del negocio"
        acciones={<Pastilla tono="marca">consultas sobre tus datos</Pastilla>}
      >
        <div className="pila">
          <div className="chat">
            {mensajes.map((m, i) => (
              <div key={i} className={`burbuja burbuja--${m.autor}`}>
                {m.texto}
                {m.motor === 'anthropic' && (
                  <div className="pequeno" style={{ opacity: .7, marginTop: 6 }}>redactado con Claude</div>
                )}
              </div>
            ))}
            {pensando && <div className="burbuja burbuja--asistente tenue">Consultando tus datos…</div>}
            <div ref={finRef} />
          </div>

          {sugerencias.length > 0 && (
            <div className="sugerencias">
              {sugerencias.map((s) => (
                <button key={s} className="sugerencia" onClick={() => enviar(s)} disabled={pensando}>{s}</button>
              ))}
            </div>
          )}

          <form onSubmit={enviarFormulario} className="fila">
            <div className="crecer">
              <Campo>
                <input
                  value={pregunta}
                  onChange={(e) => setPregunta(e.target.value)}
                  placeholder="Ej. ¿cuánto vendí esta semana?"
                  disabled={pensando}
                />
              </Campo>
            </div>
            <button className="boton boton--primario" disabled={pensando || !pregunta.trim()}>Preguntar</button>
          </form>

          <p className="pequeno tenue">
            Por defecto el asistente resuelve todo dentro de tu servidor, sin enviar datos a ningún tercero.
            Si activas el modo Claude en la configuración del servidor, solo se envía un resumen agregado de métricas.
          </p>
        </div>
      </Tarjeta>
    </div>
  );
}
