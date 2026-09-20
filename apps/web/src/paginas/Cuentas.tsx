import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { fecha, usd } from '../lib/formato';
import { AvisoError, Cargando, Kpi, Pastilla, Tabla, Tarjeta } from '../componentes/ui';

interface FilaAntiguedad {
  nombre: string;
  documentos: number;
  saldo_usd: number;
  por_vencer_usd: number;
  vencido_1_30_usd: number;
  vencido_31_60_usd: number;
  vencido_60_mas_usd: number;
}

interface Documento {
  id: number; numero: string; fecha: string; total_usd: number; saldo_usd: number;
  vence_el: string | null; cliente_nombre?: string | null; proveedor_nombre?: string | null;
}

export function Cuentas() {
  const [pestana, setPestana] = useState<'COBRAR' | 'PAGAR'>('COBRAR');
  const [antiguedad, setAntiguedad] = useState<FilaAntiguedad[]>([]);
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setCargando(true);
    const esCobrar = pestana === 'COBRAR';
    Promise.all([
      api.get<{ datos: FilaAntiguedad[] }>(esCobrar ? '/reportes/cuentas-por-cobrar' : '/reportes/cuentas-por-pagar'),
      api.get<{ datos: Documento[] }>(esCobrar ? '/ventas?soloPendientes=true&porPagina=200' : '/compras?soloPendientes=true&porPagina=200'),
    ])
      .then(([a, d]) => { setAntiguedad(a.datos); setDocumentos(d.datos); setError(null); })
      .catch(setError)
      .finally(() => setCargando(false));
  }, [pestana]);

  const totales = antiguedad.reduce(
    (a, f) => ({
      saldo: a.saldo + Number(f.saldo_usd),
      porVencer: a.porVencer + Number(f.por_vencer_usd),
      v130: a.v130 + Number(f.vencido_1_30_usd),
      v3160: a.v3160 + Number(f.vencido_31_60_usd),
      v60: a.v60 + Number(f.vencido_60_mas_usd),
    }),
    { saldo: 0, porVencer: 0, v130: 0, v3160: 0, v60: 0 },
  );

  const esCobrar = pestana === 'COBRAR';

  return (
    <div className="pila">
      <div className="fila">
        <button
          className={`boton ${esCobrar ? 'boton--primario' : 'boton--neutro'}`}
          onClick={() => setPestana('COBRAR')}
        >Por cobrar</button>
        <button
          className={`boton ${!esCobrar ? 'boton--primario' : 'boton--neutro'}`}
          onClick={() => setPestana('PAGAR')}
        >Por pagar</button>
      </div>

      <AvisoError error={error} />

      {cargando ? <Cargando /> : (
        <>
          <div className="rejilla rejilla--4">
            <Kpi etiqueta="Saldo total" valor={usd(totales.saldo)} tono="acento" />
            <Kpi etiqueta="Por vencer" valor={usd(totales.porVencer)} nota="Dentro del plazo" />
            <Kpi etiqueta="Vencido 1–60 dias" valor={usd(totales.v130 + totales.v3160)} tono="aviso" />
            <Kpi etiqueta="Vencido +60 dias" valor={usd(totales.v60)} tono="peligro" nota="Riesgo de incobrable" />
          </div>

          <Tarjeta titulo={`Antiguedad de saldos por ${esCobrar ? 'cliente' : 'proveedor'}`} pegado>
            <Tabla
              columnas={[
                { titulo: esCobrar ? 'Cliente' : 'Proveedor' }, { titulo: 'Docs', num: true },
                { titulo: 'Por vencer', num: true }, { titulo: '1–30', num: true },
                { titulo: '31–60', num: true }, { titulo: '+60', num: true }, { titulo: 'Total', num: true },
              ]}
              vacia="No hay saldos pendientes"
            >
              {antiguedad.map((f, i) => (
                <tr key={i}>
                  <td className="fuerte">{f.nombre}</td>
                  <td className="num tenue">{f.documentos}</td>
                  <td className="num">{usd(f.por_vencer_usd)}</td>
                  <td className="num">{Number(f.vencido_1_30_usd) > 0 ? <Pastilla tono="aviso">{usd(f.vencido_1_30_usd)}</Pastilla> : '—'}</td>
                  <td className="num">{Number(f.vencido_31_60_usd) > 0 ? <Pastilla tono="aviso">{usd(f.vencido_31_60_usd)}</Pastilla> : '—'}</td>
                  <td className="num">{Number(f.vencido_60_mas_usd) > 0 ? <Pastilla tono="peligro">{usd(f.vencido_60_mas_usd)}</Pastilla> : '—'}</td>
                  <td className="num fuerte">{usd(f.saldo_usd)}</td>
                </tr>
              ))}
            </Tabla>
          </Tarjeta>

          <Tarjeta
            titulo="Documentos pendientes"
            acciones={<Link className="boton boton--neutro boton--chico" to={esCobrar ? '/ventas' : '/compras'}>Ir a {esCobrar ? 'ventas' : 'compras'}</Link>}
            pegado
          >
            <Tabla
              columnas={[{ titulo: 'Numero' }, { titulo: esCobrar ? 'Cliente' : 'Proveedor' }, { titulo: 'Emitido' },
                { titulo: 'Vence' }, { titulo: 'Total', num: true }, { titulo: 'Saldo', num: true }]}
              vacia="Nada pendiente"
            >
              {documentos.map((d) => {
                const vencido = d.vence_el ? new Date(d.vence_el) < new Date() : false;
                return (
                  <tr key={d.id}>
                    <td className="mono fuerte">{d.numero}</td>
                    <td>{d.cliente_nombre ?? d.proveedor_nombre ?? <span className="tenue">—</span>}</td>
                    <td className="apretado">{fecha(d.fecha)}</td>
                    <td className="apretado">
                      {d.vence_el ? (vencido ? <Pastilla tono="peligro">{fecha(d.vence_el)}</Pastilla> : fecha(d.vence_el)) : '—'}
                    </td>
                    <td className="num">{usd(d.total_usd)}</td>
                    <td className="num fuerte">{usd(d.saldo_usd)}</td>
                  </tr>
                );
              })}
            </Tabla>
          </Tarjeta>
        </>
      )}
    </div>
  );
}
