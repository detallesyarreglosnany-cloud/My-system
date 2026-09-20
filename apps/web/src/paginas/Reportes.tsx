import { useCallback, useEffect, useState } from 'react';
import { api, consulta } from '../lib/api';
import { bs, fecha, hoyIso, numero, primerDiaDelMes, usd } from '../lib/formato';
import { AvisoError, Campo, Cargando, Kpi, Pastilla, Tabla, Tarjeta } from '../componentes/ui';

type Pestana = 'libro' | 'productos' | 'metodos' | 'inventario';

interface LibroVentas {
  detalle: Array<{
    fecha: string; numero: string; documento_cliente: string; cliente: string; anulada: boolean;
    base_imponible_usd: number; iva_usd: number; igtf_usd: number; total_usd: number;
    base_imponible_bs: number; iva_bs: number; total_bs: number;
  }>;
  totales: {
    documentos: number; anulados: number;
    base_imponible_usd: number; iva_usd: number; igtf_usd: number; total_usd: number;
    base_imponible_bs: number; iva_bs: number; igtf_bs: number; total_bs: number;
  };
}

export function Reportes() {
  const [pestana, setPestana] = useState<Pestana>('libro');
  const [desde, setDesde] = useState(primerDiaDelMes());
  const [hasta, setHasta] = useState(hoyIso());
  const [libro, setLibro] = useState<LibroVentas | null>(null);
  const [productos, setProductos] = useState<any[]>([]);
  const [metodos, setMetodos] = useState<any[]>([]);
  const [inventario, setInventario] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const rango = consulta({ desde, hasta });
      if (pestana === 'libro') setLibro(await api.get<LibroVentas>(`/reportes/libro-ventas${rango}`));
      if (pestana === 'productos') setProductos((await api.get<{ datos: any[] }>(`/reportes/top-productos${consulta({ desde, hasta, limite: 50 })}`)).datos);
      if (pestana === 'metodos') setMetodos((await api.get<{ datos: any[] }>(`/reportes/ventas-por-metodo${rango}`)).datos);
      if (pestana === 'inventario') setInventario((await api.get<{ datos: any[] }>('/reportes/inventario')).datos);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setCargando(false);
    }
  }, [pestana, desde, hasta]);

  useEffect(() => { void cargar(); }, [cargar]);

  function exportarCsv(nombre: string, filas: Array<Record<string, unknown>>) {
    if (filas.length === 0) return;
    const columnas = Object.keys(filas[0]);
    const escapar = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [columnas.join(';'), ...filas.map((f) => columnas.map((c) => escapar(f[c])).join(';'))].join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${nombre}-${desde}-a-${hasta}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const pestanas: Array<{ clave: Pestana; etiqueta: string }> = [
    { clave: 'libro', etiqueta: 'Libro de ventas' },
    { clave: 'productos', etiqueta: 'Rentabilidad por producto' },
    { clave: 'metodos', etiqueta: 'Formas de cobro' },
    { clave: 'inventario', etiqueta: 'Valorizacion de inventario' },
  ];

  return (
    <div className="pila">
      <Tarjeta>
        <div className="fila fila--entre">
          <div className="fila">
            {pestanas.map((p) => (
              <button
                key={p.clave}
                className={`boton ${pestana === p.clave ? 'boton--primario' : 'boton--neutro'} boton--chico`}
                onClick={() => setPestana(p.clave)}
              >{p.etiqueta}</button>
            ))}
          </div>
          {pestana !== 'inventario' && (
            <div className="fila">
              <Campo etiqueta="Desde"><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></Campo>
              <Campo etiqueta="Hasta"><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></Campo>
            </div>
          )}
        </div>
      </Tarjeta>

      <AvisoError error={error} />
      {cargando && <Cargando />}

      {!cargando && pestana === 'libro' && libro && (
        <>
          <div className="rejilla rejilla--4">
            <Kpi etiqueta="Base imponible" valor={usd(libro.totales.base_imponible_usd)} nota={bs(libro.totales.base_imponible_bs)} tono="acento" />
            <Kpi etiqueta="Debito fiscal (IVA)" valor={usd(libro.totales.iva_usd)} nota={bs(libro.totales.iva_bs)} />
            <Kpi etiqueta="IGTF percibido" valor={usd(libro.totales.igtf_usd)} nota={bs(libro.totales.igtf_bs)} />
            <Kpi
              etiqueta="Total facturado"
              valor={usd(libro.totales.total_usd)}
              nota={`${libro.totales.documentos} docs · ${libro.totales.anulados} anulados`}
              tono="exito"
            />
          </div>
          <Tarjeta
            titulo="Libro de ventas"
            acciones={<button className="boton boton--neutro boton--chico" onClick={() => exportarCsv('libro-ventas', libro.detalle)}>Exportar CSV</button>}
            pegado
          >
            <Tabla
              columnas={[{ titulo: 'Fecha' }, { titulo: 'Factura' }, { titulo: 'Cliente' }, { titulo: 'RIF/CI' },
                { titulo: 'Base Bs', num: true }, { titulo: 'IVA Bs', num: true }, { titulo: 'Total Bs', num: true }, { titulo: 'Total USD', num: true }]}
              vacia="Sin facturas en el periodo"
            >
              {libro.detalle.map((f) => (
                <tr key={f.numero} style={f.anulada ? { opacity: .5, textDecoration: 'line-through' } : undefined}>
                  <td className="apretado">{fecha(f.fecha)}</td>
                  <td className="mono fuerte">{f.numero}</td>
                  <td>{f.cliente}</td>
                  <td className="mono tenue">{f.documento_cliente}</td>
                  <td className="num">{numero(f.base_imponible_bs)}</td>
                  <td className="num">{numero(f.iva_bs)}</td>
                  <td className="num fuerte">{numero(f.total_bs)}</td>
                  <td className="num">{usd(f.total_usd)}</td>
                </tr>
              ))}
            </Tabla>
          </Tarjeta>
        </>
      )}

      {!cargando && pestana === 'productos' && (
        <Tarjeta
          titulo="Rentabilidad por producto"
          acciones={<button className="boton boton--neutro boton--chico" onClick={() => exportarCsv('rentabilidad', productos)}>Exportar CSV</button>}
          pegado
        >
          <Tabla
            columnas={[{ titulo: 'Producto' }, { titulo: 'Unidades', num: true }, { titulo: 'Ingreso', num: true },
              { titulo: 'Utilidad', num: true }, { titulo: 'Margen', num: true }]}
            vacia="Sin ventas en el periodo"
          >
            {productos.map((p) => {
              const ingreso = Number(p.ingreso_usd);
              const utilidad = Number(p.utilidad_usd);
              return (
                <tr key={p.id}>
                  <td><div className="fuerte">{p.nombre}</div><div className="mono tenue">{p.sku}</div></td>
                  <td className="num">{numero(p.unidades)}</td>
                  <td className="num">{usd(ingreso)}</td>
                  <td className="num fuerte">{usd(utilidad)}</td>
                  <td className="num">
                    <Pastilla tono={utilidad <= 0 ? 'peligro' : ingreso > 0 && utilidad / ingreso > 0.3 ? 'exito' : 'neutra'}>
                      {ingreso > 0 ? `${((utilidad / ingreso) * 100).toFixed(0)}%` : '—'}
                    </Pastilla>
                  </td>
                </tr>
              );
            })}
          </Tabla>
        </Tarjeta>
      )}

      {!cargando && pestana === 'metodos' && (
        <Tarjeta titulo="Como te pagan tus clientes" pegado>
          <Tabla
            columnas={[{ titulo: 'Metodo' }, { titulo: 'Moneda' }, { titulo: 'Operaciones', num: true },
              { titulo: 'Monto USD', num: true }, { titulo: 'Monto Bs', num: true }, { titulo: 'IGTF', num: true }]}
            vacia="Sin cobros en el periodo"
          >
            {metodos.map((m) => (
              <tr key={m.codigo}>
                <td className="fuerte">{m.nombre}</td>
                <td><Pastilla tono={m.moneda === 'USD' ? 'marca' : 'info'}>{m.moneda}</Pastilla></td>
                <td className="num">{numero(m.operaciones)}</td>
                <td className="num fuerte">{usd(m.monto_usd)}</td>
                <td className="num tenue">{numero(m.monto_bs)}</td>
                <td className="num">{Number(m.igtf_usd) > 0 ? usd(m.igtf_usd) : '—'}</td>
              </tr>
            ))}
          </Tabla>
        </Tarjeta>
      )}

      {!cargando && pestana === 'inventario' && (
        <Tarjeta
          titulo="Valorizacion de inventario"
          acciones={<button className="boton boton--neutro boton--chico" onClick={() => exportarCsv('inventario', inventario)}>Exportar CSV</button>}
          pegado
        >
          <Tabla
            columnas={[{ titulo: 'Producto' }, { titulo: 'Categoria' }, { titulo: 'Existencia', num: true },
              { titulo: 'Costo unit.', num: true }, { titulo: 'Valor al costo', num: true }, { titulo: 'Valor a precio', num: true }]}
            vacia="Sin productos"
          >
            {inventario.map((p) => (
              <tr key={p.id}>
                <td><div className="fuerte">{p.nombre}</div><div className="mono tenue">{p.sku}</div></td>
                <td className="tenue">{p.categoria ?? '—'}</td>
                <td className="num">{numero(p.existencia)}</td>
                <td className="num">{usd(p.costo_usd)}</td>
                <td className="num fuerte">{usd(p.valor_costo_usd)}</td>
                <td className="num tenue">{usd(p.valor_venta_usd)}</td>
              </tr>
            ))}
          </Tabla>
        </Tarjeta>
      )}
    </div>
  );
}
