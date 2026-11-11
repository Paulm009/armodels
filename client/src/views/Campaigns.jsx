import { useState } from 'react'
import CampaignCard from '../components/CampaignCard.jsx'
import { statusLabel } from '../lib.js'

export default function Campaigns({ campaigns, locales, onNewCampaign, onEdit, onTest }) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('ALL')

  const filtered = campaigns.filter((c) => {
    const matchesSearch = (c.nombre || '').toLowerCase().includes(search.toLowerCase())
    const matchesFilter = filter === 'ALL' || c.estado === filter
    return matchesSearch && matchesFilter
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-display font-extrabold text-xl">Campañas</h1>
          <p className="text-sm text-[#657069]">{campaigns.length} campañas registradas</p>
        </div>
        <button onClick={onNewCampaign} className="btn-primary px-4 py-2.5 rounded-xl text-sm font-bold">
          + Nueva campaña
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar campaña…"
          className="flex-1 px-4 py-2.5 rounded-xl border border-[#dcdad2] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#1b4332]/20"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="px-4 py-2.5 rounded-xl border border-[#dcdad2] bg-white text-sm"
        >
          <option value="ALL">Todos los estados</option>
          <option value="PUBLICADA">Publicada</option>
          <option value="EN_PREPARACION">En preparación</option>
          <option value="ARCHIVADA">Archivada</option>
          <option value="VENCIDA">Vencida</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="card p-10 text-center text-[#657069]">No se encontraron campañas.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filtered.map((c) => (
            <CampaignCard key={`${c.campaign_id}-${c.version}`} campaign={c} onEdit={onEdit} onTest={onTest} />
          ))}
        </div>
      )}
    </div>
  )
}
