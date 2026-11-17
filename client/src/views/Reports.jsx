import { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'

export default function Reports({ reports, onRefresh }) {
  const [rows, setRows] = useState(reports || [])
  const [includeAll, setIncludeAll] = useState(false)
  const [campaignFilter, setCampaignFilter] = useState('ALL')
  const [selectedKey, setSelectedKey] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!includeAll) setRows(reports || [])
  }, [reports, includeAll])

  const campaignIds = useMemo(() => Array.from(new Set((rows || []).map((r) => r.campaignId))), [rows])

  const filtered = useMemo(
    () => (rows || []).filter((r) => campaignFilter === 'ALL' || r.campaignId === campaignFilter),
    [rows, campaignFilter]
  )

  const selected = useMemo(
    () => filtered.find((r) => `${r.campaignId}-${r.version}` === selectedKey) || null,
    [filtered, selectedKey]
  )

  const toggleVersions = async () => {
    const next = !includeAll
    setIncludeAll(next)
    setLoading(true)
    setError(null)
    try {
      const data = await api.listReports(next)
      setRows(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const exportCsv = () => {
    const headers = [
      'Campaña',
      'Versión',
      'Estado',
      'Sesiones',
      'Con reconocimiento',
      'Tiempo hasta reconocimiento',
      'Seguimiento (s)',
      'Sesiones con CTA',
      'Pérdidas / minuto',
      'Tasa de error',
    ]
    const rowsCsv = filtered.map((r) => {
      const m = r.metrics || {}
      return [
        `"${r.title}"`,
        r.version,
        r.estado,
        m.sesionesConReconocimiento?.denominator ?? r.sessions,
        m.sesionesConReconocimiento?.value ?? r.recognized,
        `"${m.tiempoHastaReconocimientoMs?.formatted || 'N/C'}"`,
        m.seguimientoVisibleSegundos?.valueSec ?? r.trackingSec,
        `"${m.sesionesConCTA?.formatted || 'N/C'}"`,
        m.frecuenciaDePerdidas?.lossesPerMinute ?? 'N/C',
        `"${m.tasaErrorDeSesion?.formatted || 'N/C'}"`,
      ]
    })
    const csv = [headers.join(','), ...rowsCsv.map((row) => row.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'reportes_aranjuez_webar.csv'
    a.click()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-display font-extrabold text-xl">Reportes</h1>
          <p className="text-sm text-[#657069]">Indicadores operativos por campaña y versión (Tabla 2.7)</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button onClick={onRefresh} className="px-4 py-2.5 rounded-xl bg-white border border-[#dcdad2] text-sm font-semibold hover:bg-[#f4f3ee]">
            Actualizar
          </button>
          <button onClick={toggleVersions} className="px-4 py-2.5 rounded-xl bg-white border border-[#dcdad2] text-sm font-semibold hover:bg-[#f4f3ee]">
            {includeAll ? 'Solo última versión' : 'Ver todas las versiones'}
          </button>
          <button onClick={exportCsv} className="btn-primary px-4 py-2.5 rounded-xl text-sm font-bold">
            Exportar CSV
          </button>
        </div>
      </div>

      {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}

      <div className="flex flex-wrap gap-3">
        <select
          value={campaignFilter}
          onChange={(e) => setCampaignFilter(e.target.value)}
          className="px-4 py-2.5 rounded-xl border border-[#dcdad2] bg-white text-sm"
          aria-label="Filtrar por campaña"
        >
          <option value="ALL">Todas las campañas</option>
          {campaignIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        <div className="px-4 py-2.5 rounded-xl bg-[#f4f3ee] text-xs text-[#657069]">
          {loading ? 'Cargando…' : `${filtered.length} fila(s)`}
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="bg-[#f4f3ee] text-left text-[#657069] text-xs">
              <th className="px-4 py-3 font-semibold">Campaña</th>
              <th className="px-4 py-3 font-semibold">Versión</th>
              <th className="px-4 py-3 font-semibold">Sesiones</th>
              <th className="px-4 py-3 font-semibold">Reconocidas</th>
              <th className="px-4 py-3 font-semibold">T. reconocimiento</th>
              <th className="px-4 py-3 font-semibold">Seguimiento (s)</th>
              <th className="px-4 py-3 font-semibold">CTA</th>
              <th className="px-4 py-3 font-semibold">Pérdidas/min</th>
              <th className="px-4 py-3 font-semibold">Error</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const m = r.metrics || {}
              const key = `${r.campaignId}-${r.version}`
              return (
                <tr
                  key={key}
                  onClick={() => setSelectedKey(key)}
                  className={`border-t border-[#f0efe9] cursor-pointer transition ${
                    selectedKey === key ? 'bg-[#f4f8f1]' : 'hover:bg-[#faf9f5]'
                  }`}
                >
                  <td className="px-4 py-3 font-medium text-[#18241e]">
                    {r.title}
                    {r.local?.nombre ? <div className="text-xs text-[#657069]">{r.local.nombre}</div> : null}
                  </td>
                  <td className="px-4 py-3">v{r.version}</td>
                  <td className="px-4 py-3">{m.sesionesConReconocimiento?.denominator ?? r.sessions}</td>
                  <td className="px-4 py-3">{m.sesionesConReconocimiento?.value ?? r.recognized}</td>
                  <td className="px-4 py-3">{m.tiempoHastaReconocimientoMs?.formatted || 'N/C'}</td>
                  <td className="px-4 py-3">{m.seguimientoVisibleSegundos?.valueSec ?? r.trackingSec}</td>
                  <td className="px-4 py-3">{m.sesionesConCTA?.formatted || 'N/C'}</td>
                  <td className="px-4 py-3">{m.frecuenciaDePerdidas?.lossesPerMinute ?? 'N/C'}</td>
                  <td className="px-4 py-3">{m.tasaErrorDeSesion?.formatted || 'N/C'}</td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-[#657069]">
                  No hay datos para mostrar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="card p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-display font-bold text-lg text-[#18241e]">{selected.title}</h2>
              <p className="text-xs text-[#657069]">
                v{selected.version} · {selected.estado} · {selected.fechaInicio || '—'} → {selected.fechaFin || '—'}
              </p>
            </div>
            <button onClick={() => setSelectedKey(null)} className="text-xs font-semibold text-[#657069] hover:underline">
              Cerrar detalle
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Metric
              label="Sesiones con reconocimiento"
              value={selected.metrics?.sesionesConReconocimiento?.formatted || 'N/C'}
            />
            <Metric
              label="Tasa de reconocimiento"
              value={selected.metrics?.tasaReconocimientoPorSesion?.formatted || 'N/C'}
            />
            <Metric
              label="Tiempo hasta reconocimiento"
              value={selected.metrics?.tiempoHastaReconocimientoMs?.formatted || 'N/C'}
            />
            <Metric
              label="Seguimiento visible"
              value={selected.metrics?.seguimientoVisibleSegundos?.formatted || 'N/C'}
            />
            <Metric label="Sesiones con CTA" value={selected.metrics?.sesionesConCTA?.formatted || 'N/C'} />
            <Metric label="Frecuencia de pérdidas" value={selected.metrics?.frecuenciaDePerdidas?.formatted || 'N/C'} />
            <Metric label="Tasa de error de sesión" value={selected.metrics?.tasaErrorDeSesion?.formatted || 'N/C'} />
            <Metric label="Eventos únicos" value={selected.uniqueEventsCount != null ? String(selected.uniqueEventsCount) : 'N/C'} />
          </div>
          <p className="text-xs text-[#657069]">
            Los indicadores describen actividad registrada; no miden atención, visitas al local ni ventas (Sección 2.8.6).
          </p>
        </div>
      )}
    </div>
  )
}

function Metric({ label, value }) {
  return (
    <div className="rounded-xl border border-[#e6e4dc] bg-[#f8f7f3] p-3">
      <div className="text-[11px] text-[#657069]">{label}</div>
      <div className="font-semibold text-sm text-[#18241e] mt-1">{value}</div>
    </div>
  )
}
