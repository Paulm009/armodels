import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { WebARController, WEBAR_STATES } from '../webar/WebARController.js'
import { statusLabel } from '../lib.js'

export default function WebARModal({ campaign, onClose, onEvent }) {
  const [status, setStatus] = useState('Iniciando cámara…')
  const [tracked, setTracked] = useState(false)
  const [accumulatedSec, setAccumulatedSec] = useState(0)
  const [error, setError] = useState(null)

  const canvasRef = useRef(null)
  const controllerRef = useRef(null)
  const intervalStartRef = useRef(null)

  const content = campaign.content

  const closeInterval = useCallback(() => {
    if (intervalStartRef.current !== null) {
      const delta = (performance.now() - intervalStartRef.current) / 1000
      setAccumulatedSec((s) => s + delta)
      intervalStartRef.current = null
    }
  }, [])

  const onStateChange = useCallback(
    (state, details) => {
      if (state === WEBAR_STATES.CONTENIDO_VISIBLE) {
        setTracked(true)
        if (intervalStartRef.current === null && document.visibilityState === 'visible') {
          intervalStartRef.current = performance.now()
        }
        setStatus(details.expiredCampaign ? 'Campaña finalizada' : `Objetivo reconocido (${details.targetName || ''})`)
      } else if (state === WEBAR_STATES.RECUPERACION) {
        setTracked(false)
        closeInterval()
        setStatus('Objetivo perdido · vuelve a enfocar el afiche')
      } else if (state === WEBAR_STATES.BUSQUEDA) {
        setTracked(false)
        setStatus('Cámara lista · enfoca el afiche para reconocerlo')
      } else if (state === WEBAR_STATES.FALLO_RECUPERABLE) {
        setTracked(false)
        closeInterval()
        setError(details.message || 'No se pudo acceder a la cámara.')
      } else if (state === WEBAR_STATES.FINALIZACION) {
        setTracked(false)
        closeInterval()
      }
    },
    [closeInterval]
  )

  const onEventRef = useRef(onEvent)
  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  const onTelemetry = useCallback(() => {
    if (onEventRef.current) onEventRef.current()
  }, [])

  useEffect(() => {
    let disposed = false

    async function init() {
      try {
        const data = await api.getCampaign(campaign.campaign_id)
        if (disposed) return
        if (data.status !== 'ACTIVE' || !data.showPromotionalMedia) {
          setError(data.message || 'La campaña no está disponible para mostrar contenido.')
          setStatus(data.status === 'EXPIRED' ? 'Campaña finalizada' : 'Campaña no publicada')
          return
        }
        const canvas = canvasRef.current
        if (!canvas) return
        const controller = new WebARController({
          campaign,
          imageTargets: data.imageTargetData || [],
          onStateChange,
          onTelemetry,
        })
        controllerRef.current = controller
        await controller.start(canvas)
      } catch (err) {
        if (!disposed) setError(err.message)
      }
    }

    init()

    return () => {
      disposed = true
      closeInterval()
      if (controllerRef.current) {
        try {
          controllerRef.current.stop()
        } catch {
          /* noop */
        }
        controllerRef.current = null
      }
    }
  }, [campaign, onStateChange, onTelemetry, closeInterval])

  // Temporizador visual de seguimiento visible (Sección 2.8.3)
  useEffect(() => {
    const id = window.setInterval(() => {
      if (tracked && intervalStartRef.current !== null && document.visibilityState === 'visible') {
        const delta = (performance.now() - intervalStartRef.current) / 1000
        intervalStartRef.current = performance.now()
        setAccumulatedSec((s) => s + delta)
      }
    }, 300)
    return () => window.clearInterval(id)
  }, [tracked])

  const handleCta = () => {
    controllerRef.current?.triggerCTA(content?.cta_primaria_label || 'Ver condiciones')
    const url = content?.cta_secundaria_url || content?.cta_url
    if (url) window.open(url, '_blank', 'noopener')
  }

  const secondsLabel = accumulatedSec.toFixed(1).replace('.', ',')

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3 sm:p-5">
      <div className="bg-white rounded-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[92vh]">
        <div className="px-5 py-4 border-b border-[#e6e4dc] flex items-center justify-between">
          <div>
            <h2 className="font-display font-extrabold text-[#18241e]">{campaign.nombre}</h2>
            <p className="text-xs text-[#657069]">
              {campaign.local?.nombre || ''} · v{campaign.version} · {statusLabel(campaign.estado)}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-[#f4f3ee] text-[#657069]">
            ✕
          </button>
        </div>

        <div className="flex-1 p-5 flex flex-col lg:flex-row gap-5 overflow-y-auto">
          {/* Zona de render */}
          <div className="relative flex-1 rounded-xl overflow-hidden bg-black min-h-[320px]">
            <canvas ref={canvasRef} className="webar-canvas" />
            {error && (
              <div className="absolute inset-0 flex items-center justify-center p-6 bg-black/70 text-white text-sm text-center">
                {error}
              </div>
            )}

            <div className="absolute top-3 left-3 flex items-center gap-2">
              <span className={`px-2.5 py-1 rounded-full text-xs font-semibold text-white bg-black/60 ${tracked ? 'pulse-dot' : ''}`}>
                {tracked ? '● Objetivo seguido' : '● ' + status}
              </span>
            </div>
          </div>

          {/* Panel lateral de información */}
          <div className="w-full lg:w-72 space-y-4">
            <div className="card p-4">
              <div className="text-xs text-[#657069]">Seguimiento visible</div>
              <div className="font-display font-extrabold text-2xl text-[#18241e]">{secondsLabel} s</div>
            </div>

            <div className="card p-4 space-y-2">
              <div className="text-xs text-[#657069]">Promoción</div>
              <div className="font-semibold text-[#18241e]">{content?.titulo_promocion || campaign.nombre}</div>
              <p className="text-sm text-[#4a5750]">{content?.condiciones_texto}</p>
            </div>

            <button onClick={handleCta} className="btn-primary w-full py-2.5 rounded-xl text-sm font-bold">
              {content?.cta_primaria_label || 'Ver condiciones'}
            </button>

            <div className="text-xs text-[#657069] leading-relaxed">
              <p className="font-semibold text-[#18241e] mb-1">Cómo funciona</p>
              <p>
                Apunta la cámara al afiche. Al reconocerlo se emite <code className="bg-[#eef0f2] px-1 rounded">xrimagefound</code>{' '}
                y se muestra el contenido superpuesto.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
