import { useState, type FormEvent } from 'react';
import { useSesion } from '../lib/sesion';
import { AvisoError, Campo, Tarjeta } from '../componentes/ui';

export function Acceso() {
  const { entrar } = useSesion();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await entrar(email.trim(), password);
    } catch (err) {
      setError(err);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="acceso">
      <div className="acceso__caja">
        <div className="acceso__marca">
          <div className="lateral__logo" style={{ width: 42, height: 42, fontSize: 21 }}>F</div>
          <div>
            <h1 style={{ fontSize: 20 }}>Fina Local</h1>
            <div className="pequeno tenue">Sistema administrativo privado</div>
          </div>
        </div>

        <Tarjeta>
          <form onSubmit={enviar} className="pila">
            <AvisoError error={error} />
            <Campo etiqueta="Correo">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
                autoFocus
                placeholder="tucorreo@negocio.com"
              />
            </Campo>
            <Campo etiqueta="Clave">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                placeholder="••••••••"
              />
            </Campo>
            <button className="boton boton--primario boton--grande boton--bloque" disabled={enviando}>
              {enviando ? 'Entrando…' : 'Entrar'}
            </button>
          </form>
        </Tarjeta>

        <p className="pequeno tenue centro" style={{ marginTop: 14 }}>
          Tus datos nunca salen de este servidor.
        </p>
      </div>
    </div>
  );
}
