import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, token } from './api';

export type Rol = 'PROPIETARIO' | 'ADMIN' | 'VENDEDOR' | 'ALMACEN' | 'CONTADOR';

export interface Usuario {
  id: number;
  email: string;
  nombre: string;
  rol: Rol;
  sucursalId: number | null;
}

export interface Organizacion {
  nombre: string;
  rif: string;
  iva_tasa: number;
  igtf_tasa: number;
  direccion: string;
  telefono: string;
  email: string;
}

interface Contexto {
  usuario: Usuario | null;
  organizacion: Organizacion | null;
  cargando: boolean;
  entrar: (email: string, password: string) => Promise<void>;
  salir: () => void;
  recargarOrganizacion: () => Promise<void>;
  puede: (...roles: Rol[]) => boolean;
}

const ContextoSesion = createContext<Contexto | null>(null);

const ADMINISTRADORES: Rol[] = ['PROPIETARIO', 'ADMIN'];

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [organizacion, setOrganizacion] = useState<Organizacion | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargarOrganizacion = useCallback(async () => {
    try {
      setOrganizacion(await api.get<Organizacion>('/configuracion/organizacion'));
    } catch {
      setOrganizacion(null);
    }
  }, []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      if (!token.leer()) {
        setCargando(false);
        return;
      }
      try {
        const { usuario } = await api.get<{ usuario: Usuario }>('/auth/yo');
        if (!vivo) return;
        setUsuario(usuario);
        await cargarOrganizacion();
      } catch {
        token.borrar();
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [cargarOrganizacion]);

  useEffect(() => {
    const alExpirar = () => setUsuario(null);
    window.addEventListener('fina:sesion-expirada', alExpirar);
    return () => window.removeEventListener('fina:sesion-expirada', alExpirar);
  }, []);

  const entrar = useCallback(
    async (email: string, password: string) => {
      const r = await api.post<{ token: string; usuario: Usuario }>('/auth/login', { email, password });
      token.guardar(r.token);
      setUsuario(r.usuario);
      await cargarOrganizacion();
    },
    [cargarOrganizacion],
  );

  const salir = useCallback(() => {
    token.borrar();
    setUsuario(null);
    setOrganizacion(null);
  }, []);

  const puede = useCallback(
    (...roles: Rol[]) => (usuario ? roles.includes(usuario.rol) : false),
    [usuario],
  );

  const valor = useMemo(
    () => ({ usuario, organizacion, cargando, entrar, salir, recargarOrganizacion: cargarOrganizacion, puede }),
    [usuario, organizacion, cargando, entrar, salir, cargarOrganizacion, puede],
  );

  return <ContextoSesion.Provider value={valor}>{children}</ContextoSesion.Provider>;
}

export function useSesion(): Contexto {
  const ctx = useContext(ContextoSesion);
  if (!ctx) throw new Error('useSesion debe usarse dentro de ProveedorSesion');
  return ctx;
}

export function esAdministrador(rol: Rol | undefined): boolean {
  return rol ? ADMINISTRADORES.includes(rol) : false;
}
