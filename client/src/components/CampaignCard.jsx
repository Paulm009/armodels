import { statusLabel, statusClass, mediaTypeLabel, posterUrl } from '../lib.js'

export default function CampaignCard({ campaign, onEdit, onTest }) {
  const local = campaign.local || {}
  const content = campaign.content
  return (
    <div className="card p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display font-bold text-[#18241e] leading-tight">{campaign.nombre}</h3>
          <p className="text-xs text-[#657069] mt-1">{local.nombre || 'Local'} · v{campaign.version}</p>
        </div>
        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${statusClass(campaign.estado)}`}>
          {statusLabel(campaign.estado)}
        </span>
      </div>

      <div className="flex gap-4">
        <div className="w-24 h-32 rounded-lg overflow-hidden bg-[#f1f3ef] border border-[#e6e4dc] shrink-0">
          {posterUrl(campaign) ? (
            <img src={posterUrl(campaign)} alt={campaign.nombre} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[#657069] text-xs text-center px-1">
              Sin afiche
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-[#4a5750] line-clamp-3">{content?.titulo_promocion || content?.condiciones_texto || 'Sin descripción.'}</p>
          <div className="flex items-center gap-2 mt-3 text-xs text-[#657069]">
            <span className="pill px-2 py-1 rounded-full">{mediaTypeLabel(content)}</span>
            {campaign.fecha_inicio && campaign.fecha_fin && (
              <span>
                {campaign.fecha_inicio} → {campaign.fecha_fin}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1 border-t border-[#f0efe9]">
        <button
          onClick={() => onTest(campaign)}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#1b4332] text-white text-xs font-semibold hover:bg-[#143527] transition"
        >
          Probar AR
        </button>
        <button
          onClick={() => onEdit(campaign)}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-white hover:bg-[#f4f3ee] border border-[#dcdad2] text-xs font-semibold text-[#233129] transition"
        >
          Editar
        </button>
      </div>
    </div>
  )
}
