import { api, assetUrl } from '../api.js'
import { posterUrl } from '../lib.js'

export default function PosterModal({ campaign, onBack, onClose }) {
  const target = campaign.targets?.[0]
  const posterSrc = target?.original_path ? assetUrl(target.original_path) : posterUrl(campaign)
  const downloadSrc = target?.original_path ? assetUrl(target.original_path) : posterSrc
  const qrSrc = api.qrUrl(campaign.campaign_id, 512)
  const configuredUrl = target?.qr_access_url || ''
  const publicUrl = /^https?:/i.test(configuredUrl)
    ? configuredUrl
    : `${window.location.origin}${configuredUrl || `/ar/${campaign.campaign_id}`}`

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[92vh]">
        <div className="px-5 py-4 border-b border-[#e6e4dc] flex items-center justify-between">
          <div>
            <h2 className="font-display font-extrabold text-[#18241e]">Afiche objetivo</h2>
            <p className="text-xs text-[#657069] mt-0.5">{campaign.nombre}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-[#f4f3ee] text-[#657069]">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col items-center gap-4">
          <div className="w-full flex justify-center">
            {posterSrc ? (
              <img
                src={posterSrc}
                alt={`Afiche ${campaign.nombre}`}
                className="max-h-[52vh] rounded-xl border border-[#e6e4dc] object-contain bg-white"
              />
            ) : (
              <div className="w-full h-64 rounded-xl bg-[#f1f3ef] flex items-center justify-center text-[#657069]">
                Afiche no disponible
              </div>
            )}
          </div>

          <p className="text-sm text-[#657069] text-center max-w-sm">
            Muestra este afiche en la pantalla de este dispositivo y, desde otro dispositivo, pulsa
            «Probar con la cámara» para escanearlo.
          </p>

          <div className="w-full rounded-xl border border-[#e6e4dc] bg-[#f8f7f3] p-4 flex flex-col sm:flex-row items-center gap-4">
            <img src={qrSrc} alt={`Código QR de ${campaign.nombre}`} className="w-32 h-32 rounded-lg bg-white p-1" />
            <div className="text-center sm:text-left space-y-1">
              <div className="font-semibold text-[#18241e] text-sm">QR de acceso público</div>
              <p className="text-xs text-[#657069]">
                Escanéalo desde un teléfono para abrir la experiencia en <code>/ar/{campaign.campaign_id}</code>.
              </p>
              <a
                href={qrSrc}
                download={`qr_${campaign.campaign_id}.png`}
                className="inline-block text-xs font-semibold text-[#1b4332] underline break-all"
              >
                Descargar QR
              </a>
              <p className="text-[11px] text-[#657069] break-all">{publicUrl}</p>
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={onBack} className="px-4 py-2.5 rounded-xl border border-[#dcdad2] text-sm font-semibold hover:bg-[#f4f3ee]">
              ← Volver
            </button>
            {downloadSrc && (
              <a
                href={downloadSrc}
                download
                className="btn-primary px-4 py-2.5 rounded-xl text-sm font-bold inline-flex items-center gap-2"
              >
                Descargar afiche
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
