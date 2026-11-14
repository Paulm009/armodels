import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { WebARController, WEBAR_STATES, cameraPermissionMessage } from '../webar/WebARController.js'
import { statusLabel } from '../lib.js'

const PHASE = {
  INTRO: 'intro',
  STARTING: 'starting',
  ACTIVE: 'active',
  ERROR: 'error',
}

export default function WebARModal({ campaign, onClose, onEvent }) {
  const [phase, setPhase] = useState(PHASE.INTRO)
  const [status, setStatus] = useState('')
  const [tracked, setTracked] = useState(false)
  const [error, setError] = useState(null)
  const [infoOpen, setInfoOpen] = useState(true)
  const [sheetH, setSheetH] = useState(45) // altura (vh) de la hoja inferior en móvil

  const canvasRef = useRef(null)
  const controllerRef = useRef(null)
  const dragRef = useRef(null)

  const content = campaign.content

  const onStateChange = useCallback((state, details) => {
    if (state === WEBAR_STATES.CONTENIDO_VISIBLE) {
      setTracked(true)
      setStatus(details.expiredCampaign ? 'Campaña finalizada' : `Objetivo reconocido (${details.targetName || ''})`)
    } else if (state === WEBAR_STATES.RECUPERACION) {
      setTracked(false)
      setStatus('Objetivo perdido · vuelve a enfocar el afiche')
    } else if (state === WEBAR_STATES.BUSQUEDA) {
      setTracked(false)
      setStatus('Cámara lista · enfoca el afiche para reconocerlo')
    } else if (state === WEBAR_STATES.FALLO_RECUPERABLE) {
      setTracked(false)
      setError(details.message || 'No se pudo acceder a la cámara.')
      setPhase(PHASE.ERROR)
    } else if (state === WEBAR_STATES.FINALIZACION) {
      setTracked(false)
    }
  }, [])

  const onEventRef = useRef(onEvent)
  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  const onTelemetry = useCallback(() => {
    if (onEventRef.current) onEventRef.current()
  }, [])

  const startExperience = useCallback(async () => {
    setPhase(PHASE.STARTING)
    setError(null)
    try {
      const data = await api.getCampaign(campaign.campaign_id)
      if (data.status !== 'ACTIVE' || !data.showPromotionalMedia) {
        setError(data.message || 'La campaña no está disponible para mostrar contenido.')
        setStatus(data.status === 'EXPIRED' ? 'Campaña finalizada' : 'Campaña no publicada')
        setPhase(PHASE.ERROR)
        return
      }

      const controller = new WebARController({
        campaign,
        imageTargets: data.imageTargetData || [],
        onStateChange,
        onTelemetry,
      })
      controllerRef.current = controller

      // Permiso explícito dentro del gesto del usuario (máxima fiabilidad en iOS/Android).
      const perm = await controller.requestCameraPermission()
      if (!perm.granted) {
        setError(cameraPermissionMessage(perm.reason))
        setPhase(PHASE.ERROR)
        return
      }

      const canvas = canvasRef.current
      if (!canvas) {
        setError('No se encontró el lienzo de cámara.')
        setPhase(PHASE.ERROR)
        return
      }

      const ok = await controller.start(canvas)
      if (!ok) return // start() ya emite FALLO_RECUPERABLE con el mensaje.
      setPhase(PHASE.ACTIVE)
    } catch (err) {
      setError(err.message || 'Error al iniciar la experiencia.')
      setPhase(PHASE.ERROR)
    }
  }, [campaign, onStateChange, onTelemetry])

  useEffect(() => {
    return () => {
      if (controllerRef.current) {
        try {
          controllerRef.current.stop()
        } catch {
          /* noop */
        }
        controllerRef.current = null
      }
    }
  }, [])

  const handleCta = () => {
    controllerRef.current?.triggerCTA(content?.cta_primaria_label || 'Ver condiciones')
    const url = content?.cta_secundaria_url || content?.cta_url
    if (url) window.open(url, '_blank', 'noopener')
  }

  const onDragHandlePointerDown = (e) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = sheetH
    dragRef.current = { startY, startH }

    const onMove = (ev) => {
      if (!dragRef.current) return
      const dy = startY - ev.clientY
      const vh = window.innerHeight
      setSheetH(Math.min(80, Math.max(20, startH + (dy / vh) * 100)))
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Barra superior */}
      <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 bg-[#18241e] text-white lg:bg-white lg:border-b lg:border-[#e6e4dc]">
        <div className="min-w-0">
          <h2 className="font-display font-extrabold text-base truncate lg:text-[#18241e]">{campaign.nombre}</h2>
          <p className="text-xs text-white/70 truncate lg:text-[#657069]">
            {campaign.local?.nombre || ''} · v{campaign.version} · {statusLabel(campaign.estado)}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {phase === PHASE.ACTIVE && (
            <button
              onClick={() => setInfoOpen((v) => !v)}
              className="shrink-0 h-9 px-3 rounded-lg flex items-center gap-1.5 text-sm font-semibold text-white/80 hover:bg-white/10 lg:text-[#657069] lg:hover:bg-[#f4f3ee]"
              aria-label={infoOpen ? 'Ocultar información' : 'Mostrar información'}
            >
              {infoOpen ? 'Ocultar info' : 'Info'}
            </button>
          )}
          <button
            onClick={onClose}
            className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-white/80 hover:bg-white/10 lg:text-[#657069] lg:hover:bg-[#f4f3ee]"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Zona principal */}
      <div className="relative flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* Cámara */}
        <div className="relative flex-1 min-h-0 bg-black overflow-hidden">
          <canvas ref={canvasRef} className="webar-canvas" />

          {phase === PHASE.INTRO && (
            <div className="absolute inset-0 z-20 flex items-center justify-center p-6">
              <div className="max-w-sm w-full card p-6 text-center space-y-4">
                <div className="space-y-1">
                  <div className="font-display font-extrabold text-lg text-[#18241e]">{campaign.nombre}</div>
                  <p className="text-sm text-[#657069]">
                    Apunta la cámara al afiche del local para ver la promoción en realidad aumentada.
                  </p>
                </div>
                <button onClick={startExperience} className="btn-primary w-full py-3 rounded-xl text-sm font-bold">
                  Iniciar experiencia AR
                </button>
                <p className="text-xs text-[#657069]">
                  Se te pedirá permiso para usar la cámara trasera del dispositivo.
                </p>
              </div>
            </div>
          )}

          {phase === PHASE.STARTING && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/70 text-white">
              <div className="webar-spinner" />
              <p className="text-sm text-center px-6">Solicitando acceso a la cámara…</p>
            </div>
          )}

          {phase === PHASE.ERROR && (
            <div className="absolute inset-0 z-20 flex items-center justify-center p-6">
              <div className="max-w-sm w-full card p-6 text-center space-y-4">
                <p className="text-sm text-[#18241e]">{error || 'No se pudo iniciar la experiencia.'}</p>
                <div className="flex items-center justify-center gap-2">
                  <button onClick={startExperience} className="btn-primary px-5 py-2.5 rounded-xl text-sm font-bold">
                    Reintentar
                  </button>
                  <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-semibold text-[#657069] hover:bg-[#f4f3ee]">
                    Cerrar
                  </button>
                </div>
              </div>
            </div>
          )}

          {phase === PHASE.ACTIVE && (
            <div className="absolute top-3 left-3 z-20 flex items-center gap-2">
              <span className={`px-2.5 py-1 rounded-full text-xs font-semibold text-white bg-black/60 ${tracked ? 'pulse-dot' : ''}`}>
                {tracked ? '● Objetivo seguido' : '● ' + status}
              </span>
            </div>
          )}
        </div>

        {/* Panel de información: hoja inferior en móvil, panel lateral en escritorio */}
        {phase === PHASE.ACTIVE && infoOpen && (
          <aside className="absolute inset-x-0 bottom-0 z-30 lg:static lg:z-auto lg:w-80 lg:shrink-0 lg:bg-white lg:border-l lg:border-[#e6e4dc]">
            <div
              className="webar-sheet flex flex-col bg-[#18241e]/95 text-white backdrop-blur lg:bg-transparent lg:text-inherit rounded-t-2xl lg:rounded-none"
              style={{ '--sheet-h': `${sheetH}vh` }}
            >
              {/* Mango de arrastre (solo móvil) */}
              <div
                className="lg:hidden shrink-0 py-2 flex items-center justify-center cursor-ns-resize touch-none"
                onPointerDown={onDragHandlePointerDown}
              >
                <div className="w-10 h-1.5 rounded-full bg-white/30" />
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-4 lg:p-5 space-y-3 lg:space-y-4">
                <div className="space-y-1">
                  <div className="text-xs opacity-70 lg:text-[#657069] lg:opacity-100">Promoción</div>
                  <div className="font-semibold">{content?.titulo_promocion || campaign.nombre}</div>
                  <p className="text-sm opacity-90 lg:text-[#4a5750] lg:opacity-100">{content?.condiciones_texto}</p>
                </div>

                <button onClick={handleCta} className="btn-primary w-full py-2.5 rounded-xl text-sm font-bold">
                  {content?.cta_primaria_label || 'Ver condiciones'}
                </button>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
