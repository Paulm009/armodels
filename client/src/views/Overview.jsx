import CampaignCard from '../components/CampaignCard.jsx'

export default function Overview({ campaigns, reports, locales, onNavigate, onNewCampaign, onTest }) {
  const published = campaigns.filter((c) => c.estado === 'PUBLICADA').length
  const totalSessions = reports.reduce((acc, r) => acc + (r.sessions || 0), 0)
  const totalCta = reports.reduce((acc, r) => acc + (r.ctaClicks || 0), 0)

  return (
    <div className="space-y-8">
      <section className="hero-green-banner rounded-2xl p-6 sm:p-10 text-white">
        <h1 className="font-display font-extrabold text-2xl sm:text-3xl max-w-xl leading-tight">
          Laboratorio de experiencias WebAR para los locales de Paseo Aranjuez
        </h1>
        <p className="text-white/80 text-sm sm:text-base mt-3 max-w-xl">
          Crea, publica y mide campañas de imagen objetivo con seguimiento 8th Wall.
        </p>
        <div className="flex flex-wrap gap-3 mt-6">
          <button
            onClick={onNewCampaign}
            className="px-4 py-2.5 rounded-xl bg-[#d8e9b4] text-[#1b4332] text-sm font-bold hover:bg-white transition"
          >
            + Nueva campaña
          </button>
          <button
            onClick={() => onNavigate('howtotest')}
            className="px-4 py-2.5 rounded-xl border border-white/30 text-white text-sm font-semibold hover:bg-white/10 transition"
          >
            ¿Cómo funciona?
          </button>
        </div>
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Campañas" value={campaigns.length} sub={`${published} publicadas`} />
        <Kpi label="Locales" value={locales.length} sub="registrados" />
        <Kpi label="Sesiones" value={totalSessions} sub="acumuladas" />
        <Kpi label="Clics CTA" value={totalCta} sub="acumulados" />
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display font-bold text-lg">Campañas recientes</h2>
          <button onClick={() => onNavigate('campaigns')} className="text-sm font-semibold text-[#1b4332] hover:underline">
            Ver todas →
          </button>
        </div>
        {campaigns.length === 0 ? (
          <EmptyState onNewCampaign={onNewCampaign} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {campaigns.slice(0, 4).map((c) => (
              <CampaignCard key={`${c.campaign_id}-${c.version}`} campaign={c} onEdit={() => {}} onTest={onTest} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function Kpi({ label, value, sub }) {
  return (
    <div className="card p-5">
      <div className="text-xs text-[#657069]">{label}</div>
      <div className="font-display font-extrabold text-3xl text-[#18241e] mt-1">{value}</div>
      <div className="text-xs text-[#657069] mt-1">{sub}</div>
    </div>
  )
}

function EmptyState({ onNewCampaign }) {
  return (
    <div className="card p-10 text-center">
      <p className="text-[#657069]">No hay campañas todavía.</p>
      <button onClick={onNewCampaign} className="btn-primary px-4 py-2 rounded-xl text-sm font-semibold mt-4">
        Crear la primera campaña
      </button>
    </div>
  )
}
