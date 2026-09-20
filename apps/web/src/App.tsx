import { Navigate, Route, Routes } from 'react-router-dom';
import { useSesion } from './lib/sesion';
import { Cargando } from './componentes/ui';
import { Layout } from './componentes/Layout';
import { Acceso } from './paginas/Acceso';
import { Panel } from './paginas/Panel';
import { PuntoDeVenta } from './paginas/PuntoDeVenta';
import { Ventas } from './paginas/Ventas';
import { Inventario } from './paginas/Inventario';
import { Compras } from './paginas/Compras';
import { Contactos } from './paginas/Contactos';
import { Cuentas } from './paginas/Cuentas';
import { Reportes } from './paginas/Reportes';
import { Configuracion } from './paginas/Configuracion';
import { Asistente } from './paginas/Asistente';

export function App() {
  const { usuario, cargando } = useSesion();

  if (cargando) return <Cargando texto="Abriendo tu sistema…" />;
  if (!usuario) return <Acceso />;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Panel />} />
        <Route path="/vender" element={<PuntoDeVenta />} />
        <Route path="/ventas" element={<Ventas />} />
        <Route path="/inventario" element={<Inventario />} />
        <Route path="/compras" element={<Compras />} />
        <Route path="/clientes" element={<Contactos tipo="clientes" />} />
        <Route path="/proveedores" element={<Contactos tipo="proveedores" />} />
        <Route path="/cuentas" element={<Cuentas />} />
        <Route path="/reportes" element={<Reportes />} />
        <Route path="/asistente" element={<Asistente />} />
        <Route path="/configuracion" element={<Configuracion />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
