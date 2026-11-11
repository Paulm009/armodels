import { statusLabel } from '../lib.js'

export default function AccessChooser({ campaign, onViewPoster, onCamera, onClose }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-5 border-b border-[#e6e4dc] flex items-center justify-between">
          <div>
            <h2 className="font-display font-extrabold text-xl text-[#18241e]">Probar experiencia</h2>
            <p className="text-xs text-[#657069] mt-0.5">
              {campaign.nombre} · v{campaign.version} · {statusLabel(campaign.estado)}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-[#f4f3ee] text-[#657069]">
            ✕
          </button>
        </div>

        <div className="px-6 py-6 space-y-4">
          <p className="text-sm text-[#657069]">
            Elige cómo quieres probar esta campaña de Paseo Aranjuez.
          </p>

          <button
            onClick={onViewPoster}
            className="w-full flex items-center gap-4 p-4 rounded-2xl border border-[#dcdad2] bg-white hover:border-[#1b4332] hover:bg-[#f4f8f1] transition text-left"
          >
            <div className="w-12 h-12 rounded-xl bg-[#e9efe7] flex items-center justify-center text-2xl shrink-0">
              🖼️
            </div>
            <div>
              <div className="font-semibold text-[#18241e]">Ver afiche</div>
              <div className="text-xs text-[#657069] mt-0.5">
                Muestra el afiche objetivo en este dispositivo para enfocarlo con otra cámara.
              </div>
            </div>
          </button>

          <button
            onClick={onCamera}
            className="w-full flex items-center gap-4 p-4 rounded-2xl border border-[#1b4332] bg-[#1b4332] hover:bg-[#143527] transition text-left"
          >
            <div className="w-12 h-12 rounded-xl bg-white/15 flex items-center justify-center text-2xl shrink-0">
              📷
            </div>
            <div>
              <div className="font-semibold text-white">Probar con la cámara</div>
              <div className="text-xs text-white/70 mt-0.5">
                Escanea el afiche con la cámara para ver la experiencia AR.
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}
