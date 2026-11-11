import { useMemo, useState } from 'react'

export default function Reports({ reports, onRefresh }) {
  const [modeFilter, setModeFilter] = useState('ALL')
  const [campaignFilter, setCampaignFilter] = useState('ALL')

  const campaignIds = useMemo(() => Array.from(new Set(reports.map((r) => r.campaignId))), [reports])

  const filtered = reports.filter((r) => {
    const okMode = modeFilter === 'ALL' || r.mode === modeFilter
    const okCampaign = campaignFilter === 'ALL' || r.campaignId === campaignFilter
    return okMode && okCampaign
  })

  const exportCsv = () => {
    const headers = ['Campaña', 'Versión', 'Modo', 'Sesiones', 'Con reconocimiento', 'Seguimiento (s)', 'Clics CTA', 'Errores']
    const rows = filtered.map((r) => [`"${r.title}"`, r.version, r.mode, r.sessions, r.recognized, r.trackingSec, r.ctaClicks, r.errors])
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
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
          <p className="text-sm text-[#657069]">Resultados por campaña y versión</p>
        </div>
        <div className="flex gap-3">
          <button onClick={onRefresh} className="px-4 py-2.5 rounded-xl bg-white border border-[#dcdad2] text-sm font-semibold hover:bg-[#f4f3ee]">
            Actualizar
          </button>
          <button onClick={exportCsv} className="btn-primary px-4 py-2.5 rounded-xl text-sm font-bold">
            Exportar CSV
          </button>
        </div>
      </div>

      <div className="flex gap-3">
        <select value={modeFilter} onChange={(e) => setModeFilter(e.target.value)} className="px-4 py-2.5 rounded-xl border border-[#dcdad2] bg-white text-sm">
          <option value="ALL">Todos los modos</option>
          <option value="CAMERA">Cámara (8th Wall)</option>
          <option value="PREVIEW">Vista previa</option>
        </select>
        <select value={campaignFilter} onChange={(e) => setCampaignFilter(e.target.value)} className="px-4 py-2.5 rounded-xl border border-[#dcdad2] bg-white text-sm">
          <option value="ALL">Todas las campañas</option>
          {campaignIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#f4f3ee] text-left text-[#657069] text-xs">
              <th className="px-4 py-3 font-semibold">Campaña</th>
              <th className="px-4 py-3 font-semibold">Versión</th>
              <th className="px-4 py-3 font-semibold">Sesiones</th>
              <th className="px-4 py-3 font-semibold">Reconocidas</th>
              <th className="px-4 py-3 font-semibold">Seguimiento (s)</th>
              <th className="px-4 py-3 font-semibold">CTA</th>
              <th className="px-4 py-3 font-semibold">Errores</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={`${r.campaignId}-${r.version}-${r.mode}`} className="border-t border-[#f0efe9]">
                <td className="px-4 py-3 font-medium text-[#18241e]">{r.title}</td>
                <td className="px-4 py-3">v{r.version}</td>
                <td className="px-4 py-3">{r.sessions}</td>
                <td className="px-4 py-3">{r.recognized}</td>
                <td className="px-4 py-3">{r.trackingSec}</td>
                <td className="px-4 py-3">{r.ctaClicks}</td>
                <td className="px-4 py-3">{r.errors}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-[#657069]">
                  No hay datos para mostrar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
