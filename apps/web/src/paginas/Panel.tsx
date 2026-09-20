import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { bs, fecha, numero, porcentaje, usd } from '../lib/formato';
import { AvisoError, Barras, Cargando, Kpi, Pastilla, Tabla, Tarjeta } from '../componentes/ui';

interface Resumen {
  tasa: { valor: number; fecha: string; fuente: string };
  hoy: { facturas: number; ventas_usd: number; ventas_bs: number; utilidad_usd: number; ticket_promedio_usd: number };
  mes: {
    facturas: number; ventas_usd: number; costo_usd: number; utilidad_usd: number;
    margen_pct: number; iva_usd: number; compras_usd: number;
  };
  cuentas_por_cobrar: { total_usd: number; vencido_usd: number; documentos: number };
  cuentas_por_pagar: { total_usd: number; vencido_usd: number; documentos: number };
  inventario: { valor_usd: number; unidades: number; referencias: number; alertas_stock_bajo: number };
  clientes_activos: number;
}

interface FilaDia { dia: string; ventas_usd: number; utilidad_usd: number; facturas: number }
interface FilaTop { id: number; sku: string; nombre: string; unidades: number; ingreso_usd: number; utilidad_usd: number }
interface FilaStock { producto_id: number; sku: string; nombre: string; existencia: number; stock_minimo: number; detalle: string }

export function Panel() {
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [dias, setDias] = useState<FilaDia[]>([]);
  const [top, setTop] = useState<FilaTop[]>([]);
  const [stock, setStock] = useState<FilaStock[]>([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    (async () => {
      try {
        const [r, d, t, s] = await Promise.all([
          api.get<Resumen>('/reportes/resumen'),
          api.get<{ datos: FilaDia[] }>('/reportes/ventas-por-dia?dias=30'),
          api.get<{ datos: FilaTop[] }>('/reportes/top-productos?limite=6'),
          api.get<{ datos: FilaStock[] }>('/productos/alertas/stock-bajo'),
        ]);
        setResumen(r);
        setDias(d.datos);
        setTop(t.datos);
        setStock(s.datos.slice(0, 8));
      } catch (e) {
        setError(e);
      }
    })();
  }, []);

  if (error) return <AvisoError error={error} />;
  if (!resumen) return <Cargando />;

  const r = resumen;

  return (
    <div className="pila">
      <div className="rejilla rejilla--4">
        <Kpi
          etiqueta="Ventas de hoy"
          valor={usd(r.hoy.ventas_usd)}
          nota={`${bs(r.hoy.ventas_bs)} · ${r.hoy.facturas} factura(s)`}
          tono="acento"
        />
        <Kpi
          etiqueta="Utilidad del mes"
          valor={usd(r.mes.utilidad_usd)}
          nota={`Margen ${porcentaje(r.mes.margen_pct)} sobre ${usd(r.mes.ventas_usd)}`}
          tono="exito"
        />
        <Kpi
          etiqueta="Por cobrar"
          valor={usd(r.cuentas_por_cobrar.total_usd)}
          nota={`${usd(r.cuentas_por_cobrar.vencido_usd)} vencido · ${r.cuentas_por_cobrar.documentos} doc.`}
          tono={r.cuentas_por_cobrar.vencido_usd > 0 ? 'peligro' : undefined}
        />
        <Kpi
          etiqueta="Por pagar"
          valor={usd(r.cuentas_por_pagar.total_usd)}
          nota={`${usd(r.cuentas_por_pagar.vencido_usd)} vencido · ${r.cuentas_por_pagar.documentos} doc.`}
          tono={r.cuentas_por_pagar.vencido_usd > 0 ? 'aviso' : undefined}
        />
      </div>

      <div className="rejilla rejilla--2">
        <Tarjeta
          titulo="Ventas de los ultimos 30 dias"
          acciones={<Pastilla tono="marca">{usd(dias.reduce((a, d) => a + Number(d.ventas_usd), 0))}</Pastilla>}
        >
          <Barras
            datos={dias.map((d) => ({ etiqueta: fecha(d.dia), valor: Number(d.ventas_usd) }))}
            formato={usd}
          />
          <div className="separador" style={{ margin: '16px 0 12px' }} />
          <div className="rejilla rejilla--3" style={{ gap: 12 }}>
            <div>
              <div className="campo__etiqueta">Promedio diario</div>
              <div className="fuerte num" style={{ fontSize: 17 }}>
                {usd(dias.reduce((a, d) => a + Number(d.ventas_usd), 0) / Math.max(dias.length, 1))}
              </div>
            </div>
            <div>
              <div className="campo__etiqueta">Mejor dia</div>
              <div className="fuerte num" style={{ fontSize: 17 }}>
                {usd(Math.max(...dias.map((d) => Number(d.ventas_usd)), 0))}
              </div>
            </div>
            <div>
              <div className="campo__etiqueta">Utilidad acumulada</div>
              <div className="fuerte num" style={{ fontSize: 17 }}>
                {usd(dias.reduce((a, d) => a + Number(d.utilidad_usd), 0))}
              </div>
            </div>
          </div>
        </Tarjeta>

        <Tarjeta titulo="Estado del negocio">
          <div className="rejilla rejilla--3" style={{ gap: 12 }}>
            <Kpi etiqueta="Inventario al costo" valor={usd(r.inventario.valor_usd)} nota={`${numero(r.inventario.unidades)} unidades`} />
            <Kpi etiqueta="Referencias" valor={numero(r.inventario.referencias)} nota={`${r.inventario.alertas_stock_bajo} en alerta`} />
            <Kpi etiqueta="Clientes activos" valor={numero(r.clientes_activos)} nota={`Ticket hoy ${usd(r.hoy.ticket_promedio_usd)}`} />
            <Kpi etiqueta="IVA del mes" valor={usd(r.mes.iva_usd)} nota="Debito fiscal generado" />
            <Kpi etiqueta="Compras del mes" valor={usd(r.mes.compras_usd)} nota={`${r.mes.facturas} ventas emitidas`} />
            <Kpi etiqueta="Tasa vigente" valor={bs(r.tasa.valor)} nota={`${fecha(r.tasa.fecha)} · ${r.tasa.fuente.toLowerCase()}`} />
          </div>
        </Tarjeta>
      </div>

      <div className="rejilla rejilla--2">
        <Tarjeta titulo="Productos que mas ingresos dejan" pegado>
          <Tabla
            columnas={[{ titulo: 'Producto' }, { titulo: 'Unid.', num: true }, { titulo: 'Ingreso', num: true }, { titulo: 'Utilidad', num: true }]}
            vacia="Todavia no hay ventas"
          >
            {top.map((p) => (
              <tr key={p.id}>
                <td>
                  <div className="fuerte">{p.nombre}</div>
                  <div className="mono tenue">{p.sku}</div>
                </td>
                <td className="num">{numero(p.unidades)}</td>
                <td className="num">{usd(p.ingreso_usd)}</td>
                <td className="num">{usd(p.utilidad_usd)}</td>
              </tr>
            ))}
          </Tabla>
        </Tarjeta>

        <Tarjeta
          titulo="Alertas de stock"
          acciones={<Link className="boton boton--neutro boton--chico" to="/inventario">Ver inventario</Link>}
          pegado
        >
          <Tabla
            columnas={[{ titulo: 'Producto' }, { titulo: 'Donde esta' }, { titulo: 'Total', num: true }, { titulo: 'Minimo', num: true }]}
            vacia="Ningun producto por debajo del minimo"
          >
            {stock.map((s) => (
              <tr key={s.producto_id}>
                <td>
                  <div className="fuerte">{s.nombre}</div>
                  <div className="mono tenue">{s.sku}</div>
                </td>
                <td className="tenue pequeno">{s.detalle}</td>
                <td className="num">
                  <Pastilla tono={Number(s.existencia) <= 0 ? 'peligro' : 'aviso'}>{numero(s.existencia)}</Pastilla>
                </td>
                <td className="num tenue">{numero(s.stock_minimo)}</td>
              </tr>
            ))}
          </Tabla>
        </Tarjeta>
      </div>
    </div>
  );
}
