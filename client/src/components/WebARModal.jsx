import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import { WebARController, WEBAR_STATES, cameraPermissionMessage } from '../webar/WebARController.js'
import { detectCapabilities, summarizeCapabilities } from '../webar/capabilities.js'
import { statusLabel } from '../lib.js'

const PHASE = {
  INTRO: 'intro',
  STARTING: 'starting',
  ACTIVE: 'active',
  ERROR: 'error',
}

export default function WebARModal({ campaign, onClose, onEvent, accessMechanism = 'DIRECT_URL' }) {
  const [phase, setPhase] = useState(PHASE.INTRO)
  const [status, setStatus] = useState('')
  const [tracked, setTracked] = useState(false)
  const [error, setError] = useState(null)
  const [errorType, setErrorType] = useState(null)
  const [canRetry, setCanRetry] = useState(true)
  const [infoOpen, setInfoOpen] = useState(false)
  const [needsPlay, setNeedsPlay] = useState(false)
  const [fallbackOpen, setFallbackOpen] = useState(false)
  const [progress, setProgress] = useState('')
  const [freshCampaign, setFreshCampaign] = useState(null)
  const [sheetH, setSheetH] = useState(45)

  const capabilities = useMemo(() => detectCapabilities(), [])
  const canvasRef = useRef(null)
  const controllerRef = useRef(null)
  const dragRef = useRef(null)

  const content = freshCampaign?.content || campaign.content
  const local = freshCampaign?.local || campaign.local

  const onEventRef = useRef(onEvent)
  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  const handleStateChange = useCallback((state, details = {}) => {
    if (state === WEBAR_STATES.PREPARACION) {
      setProgress(details.message || 'Preparando la experiencia…')
      setStatus(details.message || 'Preparando…')
    } else if (state === WEBAR_STATES.BUSQUEDA) {
      setTracked(false)
      setProgress('')
      setStatus(details.message || 'Cámara lista · enfoca el afiche para reconocerlo')
      setPhase(PHASE.ACTIVE)
    } else if (state === WEBAR_STATES.CONTENIDO_VISIBLE) {
      setTracked(true)
      setPhase(PHASE.ACTIVE)
      setNeedsPlay(Boolean(details.needsPlay))
      setStatus(
        details.expiredCampaign
          ? 'Campaña finalizada'
          : `Objetivo reconocido${details.targetName ? ` (${details.targetName})` : ''}`
      )
    } else if (state === WEBAR_STATES.RECUPERACION) {
      setTracked(false)
      setNeedsPlay(false)
      setPhase(PHASE.ACTIVE)
      setStatus(details.message || 'Objetivo perdido · vuelve a enfocar el afiche')
    } else if (state === WEBAR_STATES.FALLO_RECUPERABLE) {
      setTracked(false)
      setError(details.message || 'No se pudo acceder a la cámara.')
      setErrorType(details.errorType || 'UNKNOWN')
      setCanRetry(details.canRetry !== false)
      setProgress('')
      setPhase(PHASE.ERROR)
    } else if (state === WEBAR_STATES.FINALIZACION) {
      setTracked(false)
    }
  }, [])

  const onPlaybackBlocked = useCallback((blocked) => {
    setNeedsPlay(Boolean(blocked))
  }, [])

  const onTelemetry = useCallback(() => {
    if (onEventRef.current) onEventRef.current()
  }, [])

  const stopCurrent = useCallback(() => {
    if (!controllerRef.current) return
    try {
      controllerRef.current.stop()
    } catch {
      /* noop */
    }
    controllerRef.current = null
  }, [])

  const startExperience = useCallback(async () => {
    setError(null)
    setErrorType(null)
    setNeedsPlay(false)
    setFallbackOpen(false)
    setProgress('')

    if (capabilities.blockers.length > 0) {
      setError(capabilities.blockers.map((item) => item.message).join(' '))
      setErrorType('UNSUPPORTED')
      setCanRetry(false)
      setPhase(PHASE.ERROR)
      return
    }

    setPhase(PHASE.STARTING)
    stopCurrent()

    try {
      const data = await api.getCampaign(campaign.campaign_id)
      setFreshCampaign(data.campaign || null)

      if (data.status !== 'ACTIVE' || !data.showPromotionalMedia) {
        setError(data.message || 'La campaña no está disponible para mostrar contenido.')
        setErrorType(data.status === 'EXPIRED' ? 'EXPIRED' : 'NOT_PUBLISHED')
        setCanRetry(false)
        setPhase(PHASE.ERROR)
        return
      }

      const controller = new WebARController({
        campaign: data.campaign || campaign,
        imageTargets: data.imageTargetData || [],
        accessMechanism,
        onStateChange: handleStateChange,
        onTelemetry,
        onPlaybackBlocked,
      })
      controllerRef.current = controller

      const permission = await controller.requestCameraPermission()
      if (!permission.granted) {
        setError(cameraPermissionMessage(permission.reason))
        setErrorType('PERMISSION_ERROR')
        setCanRetry(true)
        setPhase(PHASE.ERROR)
        return
      }

      const canvas = canvasRef.current
      if (!canvas) {
        setError('No se encontró el lienzo de cámara.')
        setErrorType('NO_CANVAS')
        setPhase(PHASE.ERROR)
        return
      }

      const ok = await controller.start(canvas)
      if (!ok) {
        setPhase(PHASE.ERROR)
      } else {
        setPhase(PHASE.ACTIVE)
        setStatus('Cámara lista · enfoca el afiche para reconocerlo')
      }
    } catch (err) {
      setError(err.message || 'Error al iniciar la experiencia.')
      setErrorType('UNKNOWN')
      setCanRetry(true)
      setPhase(PHASE.ERROR)
    }
  }, [accessMechanism, campaign, capabilities.blockers, handleStateChange, onPlaybackBlocked, onTelemetry, stopCurrent])

  useEffect(() => {
    return () => {
      stopCurrent()
    }
  }, [stopCurrent])

  const handleClose = useCallback(() => {
    stopCurrent()
    onClose()
  }, [onClose, stopCurrent])

  const handleCta = () => {
    controllerRef.current?.triggerCTA(content?.cta_primaria_label || 'Ver condiciones')
    const url = content?.cta_secundaria_url || content?.cta_url
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setStatus('Enlace copiado. Ábrelo en Safari o Chrome.')
    } catch {
      setStatus('Copia la dirección de esta página y ábrela en Safari o Chrome.')
    }
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

  const blockers = capabilities.blockers
  const warnings = capabilities.warnings
  const unsupported = blockers.length > 0

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black"
      role="dialog"
      aria-modal="true"
      aria-label={`Experiencia WebAR: ${campaign.nombre}`}
    >
      <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 bg-[#18241e] text-white lg:bg-white lg:border-b lg:border-[#e6e4dc]">
        <div className="min-w-0">
          <h2 className="font-display font-extrabold text-base truncate lg:text-[#18241e]">{campaign.nombre}</h2>
          <p className="text-xs text-white/70 truncate lg:text-[#657069]">
            {local?.nombre || ''} · v{campaign.version} · {statusLabel(campaign.estado)}
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
            onClick={handleClose}
            className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-white/80 hover:bg-white/10 lg:text-[#657069] lg:hover:bg-[#f4f3ee]"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="relative flex-1 min-h-0 flex flex-col lg:flex-row">
        <div className="relative flex-1 min-h-0 bg-black overflow-hidden">
          <canvas ref={canvasRef} className="webar-canvas" aria-label="Vista de cámara con realidad aumentada" />

          {phase === PHASE.INTRO && (
            <div className="absolute inset-0 z-20 flex items-center justify-center p-4 overflow-y-auto">
              <div className="max-w-md w-full card p-6 space-y-4">
                <div className="space-y-1 text-center">
                  <div className="font-display font-extrabold text-lg text-[#18241e]">{campaign.nombre}</div>
                  <p className="text-sm text-[#657069]">
                    Apunta la cámara al afiche del local para ver la promoción en realidad aumentada.
                  </p>
                </div>

                <div className="rounded-xl border border-[#e6e4dc] bg-[#f8f7f3] p-3 text-xs text-[#4a5750]">
                  <div className="font-semibold text-[#18241e]">Compatibilidad detectada</div>
                  <div className="mt-1">{summarizeCapabilities(capabilities) || 'Sin datos del dispositivo'}</div>
                  {unsupported && (
                    <ul className="mt-2 space-y-1 text-red-700">
                      {blockers.map((item) => (
                        <li key={item.code}>• {item.message}</li>
                      ))}
                    </ul>
                  )}
                  {warnings.map((item) => (
                    <p key={item.code} className="mt-2 text-[#8a5a00]">
                      • {item.message}
                    </p>
                  ))}
                  {capabilities.inAppBrowser && (
                    <button type="button" onClick={copyLink} className="mt-2 underline font-semibold">
                      Copiar enlace para abrirlo en Safari/Chrome
                    </button>
                  )}
                </div>

                <button
                  onClick={startExperience}
                  disabled={unsupported}
                  className="btn-primary w-full py-3 rounded-xl text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Iniciar experiencia AR
                </button>
                <button
                  type="button"
                  onClick={() => setFallbackOpen(true)}
                  className="w-full py-2.5 rounded-xl border border-[#dcdad2] text-sm font-semibold text-[#4a5750] hover:bg-[#f4f3ee]"
                >
                  Ver promoción sin cámara
                </button>
                <p className="text-xs text-[#657069] text-center">
                  Se solicitará permiso para usar la cámara trasera. La experiencia requiere HTTPS.
                </p>
              </div>
            </div>
          )}

          {phase === PHASE.STARTING && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/75 text-white px-6">
              <div className="webar-spinner" />
              <p className="text-sm text-center" aria-live="polite">
                {progress || 'Solicitando acceso a la cámara…'}
              </p>
              <p className="text-xs text-white/60 text-center max-w-xs">
                La primera vez puede tardar unos segundos porque se descarga el motor de seguimiento.
              </p>
            </div>
          )}

          {phase === PHASE.ERROR && (
            <div className="absolute inset-0 z-20 flex items-center justify-center p-4 overflow-y-auto">
              <div className="max-w-md w-full card p-6 space-y-4">
                <div className="text-center space-y-2">
                  <p className="text-sm text-[#18241e]" aria-live="assertive">
                    {error || 'No se pudo iniciar la experiencia.'}
                  </p>
                  {errorType && <p className="text-xs text-[#657069]">Motivo: {humanErrorType(errorType)}</p>}
                </div>

                {warnings.length > 0 && (
                  <ul className="text-xs text-[#8a5a00] space-y-1">
                    {warnings.map((item) => (
                      <li key={item.code}>• {item.message}</li>
                    ))}
                  </ul>
                )}

                <div className="flex flex-wrap items-center justify-center gap-2">
                  {canRetry && (
                    <button onClick={startExperience} className="btn-primary px-5 py-2.5 rounded-xl text-sm font-bold">
                      Reintentar
                    </button>
                  )}
                  <button
                    onClick={() => setFallbackOpen(true)}
                    className="px-5 py-2.5 rounded-xl border border-[#dcdad2] text-sm font-semibold hover:bg-[#f4f3ee]"
                  >
                    Ver promoción sin cámara
                  </button>
                  <button
                    onClick={handleClose}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold text-[#657069] hover:bg-[#f4f3ee]"
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            </div>
          )}

          {phase === PHASE.ACTIVE && (
            <div className="absolute top-3 left-3 right-3 z-20 flex items-start justify-between gap-2 pointer-events-none">
              <span
                className={`px-2.5 py-1 rounded-full text-xs font-semibold text-white bg-black/65 pointer-events-auto ${
                  tracked ? 'pulse-dot' : ''
                }`}
                aria-live="polite"
              >
                {tracked ? '● Objetivo seguido' : `● ${status}`}
              </span>
            </div>
          )}

          {phase === PHASE.ACTIVE && needsPlay && (
            <div className="absolute inset-0 z-20 flex items-center justify-center p-6 pointer-events-none">
              <div className="card p-5 text-center space-y-3 pointer-events-auto max-w-xs">
                <p className="text-sm text-[#18241e]">El navegador bloqueó la reproducción automática del video.</p>
                <button
                  onClick={() => controllerRef.current?.playMedia()}
                  className="btn-primary w-full py-2.5 rounded-xl text-sm font-bold"
                >
                  Reproducir video
                </button>
              </div>
            </div>
          )}

          {phase === PHASE.ACTIVE && warnings.length > 0 && (
            <div className="absolute bottom-3 left-3 right-3 z-20 rounded-xl bg-black/70 text-white text-xs p-3 space-y-1">
              {warnings.map((item) => (
                <p key={item.code}>• {item.message}</p>
              ))}
              {capabilities.inAppBrowser && (
                <button type="button" onClick={copyLink} className="underline font-semibold">
                  Copiar enlace
                </button>
              )}
            </div>
          )}
        </div>

        {phase === PHASE.ACTIVE && infoOpen && (
          <aside className="absolute inset-x-0 bottom-0 z-30 lg:static lg:z-auto lg:w-80 lg:shrink-0 lg:bg-white lg:border-l lg:border-[#e6e4dc]">
            <div
              className="webar-sheet flex flex-col bg-[#18241e]/95 text-white backdrop-blur lg:bg-transparent lg:text-inherit rounded-t-2xl lg:rounded-none"
              style={{ '--sheet-h': `${sheetH}vh` }}
            >
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

      {fallbackOpen && (
        <div className="absolute inset-0 z-40 bg-black/80 flex items-center justify-center p-4">
          <div className="card max-w-md w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true">
            <div className="space-y-1">
              <div className="text-xs text-[#657069]">Consulta alternativa sin cámara</div>
              <h3 className="font-display font-extrabold text-xl text-[#18241e]">{content?.titulo_promocion || campaign.nombre}</h3>
              <p className="text-sm text-[#657069]">
                {local?.nombre || ''} {local?.ubicacion ? `· ${local.ubicacion}` : ''}
              </p>
            </div>
            <p className="text-sm text-[#4a5750]">{content?.condiciones_texto || 'Consulta las condiciones en el local.'}</p>
            <div className="flex flex-col sm:flex-row gap-2">
              {content?.cta_secundaria_url && (
                <a
                  href={content.cta_secundaria_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => controllerRef.current?.triggerCTA(content?.cta_primaria_label || 'Ver condiciones')}
                  className="btn-primary px-4 py-2.5 rounded-xl text-sm font-bold text-center"
                >
                  {content?.cta_primaria_label || 'Ver condiciones'}
                </a>
              )}
              <button
                onClick={() => setFallbackOpen(false)}
                className="px-4 py-2.5 rounded-xl border border-[#dcdad2] text-sm font-semibold hover:bg-[#f4f3ee]"
              >
                Volver
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function humanErrorType(type) {
  const labels = {
    UNSUPPORTED: 'dispositivo o navegador no compatible',
    PERMISSION_ERROR: 'permiso de cámara',
    PERMISSION_OR_CAMERA_ERROR: 'permiso o cámara',
    RESOURCE_ERROR: 'carga de recursos',
    CAMERA_ERROR: 'cámara',
    CONTENT_ERROR: 'contenido',
    NO_TARGETS: 'imagen objetivo',
    EXPIRED: 'campaña finalizada',
    NOT_PUBLISHED: 'campaña no publicada',
    NO_CANVAS: 'lienzo de cámara',
    UNKNOWN: 'error desconocido',
  }
  return labels[type] || type
}
