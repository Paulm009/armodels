import { useCallback, useEffect, useState } from 'react'
import { api, assetUrl } from '../api.js'
import WebARModal from './WebARModal.jsx'
import { statusLabel } from '../lib.js'

export default function PublicExperience({ campaignId, accessMechanism = 'DIRECT_URL' }) {
  const [state, setState] = useState({ loading: true, data: null, error: null })
  const [webar, setWebar] = useState(false)

  const load = useCallback(async () => {
    setState({ loading: true, data: null, error: null })
    try {
      const data = await api.getCampaign(campaignId)
      setState({ loading: false, data, error: null })
    } catch (err) {
      setState({ loading: false, data: null, error: err.message || 'Campaña no disponible.' })
    }
  }, [campaignId])

  useEffect(() => {
    load()
  }, [load])

  if (state.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f7f3] text-[#657069]">
        Cargando promoción…
      </div>
    )
  }

  if (state.error || !state.data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[#f8f7f3]">
        <div className="card max-w-md w-full p-6 text-center space-y-4">
          <h1 className="font-display font-extrabold text-xl text-[#18241e]">Promoción no disponible</h1>
          <p className="text-sm text-[#657069]">{state.error || 'No encontramos esta campaña.'}</p>
          <button onClick={load} className="btn-primary px-5 py-2.5 rounded-xl text-sm font-bold">
            Reintentar
          </button>
        </div>
      </div>
    )
  }

  const data = state.data
  const campaign = data.campaign
  const content = campaign?.content
  const target = campaign?.targets?.[0]
  const isActive = data.status === 'ACTIVE' && data.showPromotionalMedia

  return (
    <div className="min-h-screen bg-[#f8f7f3] p-4 sm:p-8">
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="card overflow-hidden">
          {target?.original_path && (
            <img
              src={assetUrl(target.original_path)}
              alt={`Afiche de ${campaign.nombre}`}
              className="w-full max-h-72 object-cover bg-[#f1f3ef]"
            />
          )}
          <div className="p-6 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="font-display font-extrabold text-2xl text-[#18241e]">{campaign?.nombre || 'Promoción'}</h1>
                <p className="text-sm text-[#657069]">
                  {campaign?.local?.nombre || ''} {campaign?.local?.ubicacion ? `· ${campaign.local.ubicacion}` : ''}
                </p>
              </div>
              <span className="pill px-3 py-1 rounded-full text-xs font-semibold">{statusLabel(campaign?.estado)}</span>
            </div>

            <div className="space-y-1">
              <div className="font-semibold text-[#18241e]">{content?.titulo_promocion || campaign?.nombre}</div>
              <p className="text-sm text-[#4a5750]">{content?.condiciones_texto || 'Consulta las condiciones en el local.'}</p>
              {campaign?.fecha_fin && (
                <p className="text-xs text-[#657069]">Vigente hasta {campaign.fecha_fin}</p>
              )}
            </div>

            {isActive ? (
              <button onClick={() => setWebar(true)} className="btn-primary w-full py-3 rounded-xl text-sm font-bold">
                Iniciar experiencia AR
              </button>
            ) : (
              <div className="rounded-xl bg-[#fff4e0] text-[#8a5a00] p-3 text-sm">
                {data.message || 'Esta promoción ya no está disponible para la experiencia AR.'}
              </div>
            )}

            {content?.cta_secundaria_url && (
              <a
                href={content.cta_secundaria_url}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center px-4 py-2.5 rounded-xl border border-[#dcdad2] text-sm font-semibold hover:bg-[#f4f3ee]"
              >
                {content?.cta_primaria_label || 'Ver condiciones'}
              </a>
            )}

            <p className="text-xs text-[#657069]">
              La experiencia AR requiere HTTPS, cámara y un navegador compatible. Si no puedes usarla, la información de
              la promoción permanece visible aquí.
            </p>
          </div>
        </div>

        <p className="text-center text-xs text-[#657069]">Paseo Aranjuez · Experiencia WebAR</p>
      </div>

      {webar && (
        <WebARModal
          campaign={campaign}
          accessMechanism={accessMechanism}
          onClose={() => setWebar(false)}
          onEvent={() => {}}
        />
      )}
    </div>
  )
}
