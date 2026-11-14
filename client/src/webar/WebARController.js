/**
 * ============================================================================
 * CONTROLADOR WEBAR CON 8TH WALL (Image Tracking) - PASEO ARANJUEZ
 * Máquina de estados (Figura 2.1), jerarquía Three.js, telemetría sendBeacon.
 * Soporta contenido de tipo video (VideoTexture) o imagen (Texture).
 *
 * Cámara: se solicita explícitamente permiso con gesto del usuario, se fuerza
 * la cámara trasera (mayor calidad) y se pide resolución HD nativa con
 * degradación elegante (sin filtro, sin pixelado). Se evita el chunk de SLAM.
 * ============================================================================
 */
import * as THREE from 'three'
import { load8thWallEngine } from './loadEngine.js'
import { api } from '../api.js'

export const WEBAR_STATES = Object.freeze({
  PREPARACION: 'PREPARACION',
  BUSQUEDA: 'BUSQUEDA',
  CONTENIDO_VISIBLE: 'CONTENIDO_VISIBLE',
  RECUPERACION: 'RECUPERACION',
  FALLO_RECUPERABLE: 'FALLO_RECUPERABLE',
  FINALIZACION: 'FINALIZACION',
})

export class WebARController {
  constructor({ campaign, imageTargets, telemetry = true, onStateChange = () => {}, onTelemetry = () => {} }) {
    this.campaign = campaign
    this.imageTargets = imageTargets || []
    this.telemetry = telemetry
    this.onStateChange = onStateChange
    this.onTelemetry = onTelemetry

    this.state = WEBAR_STATES.PREPARACION
    this.sessionId = `ses_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    this.hasInitialRecognition = false
    this.isTargetCurrentlyTracked = false
    this.activeTargetMeta = null
    this.activeIntervalStartMs = null
    this.visibleTrackingTotalMs = 0
    this.lossCount = 0
    this.scanningStartMs = null
    this.firstRecognitionLatencyMs = null

    this.targetContainerGroup = null
    this.mediaEl = null
    this.mediaTexture = null
    this.visibilityHandler = this.handleVisibilityChange.bind(this)
    this.canvas = null
    this.running = false
  }

  setState(nextState, details = {}) {
    this.state = nextState
    this.onStateChange(nextState, details)
  }

  /**
   * Solicita permiso de cámara de forma explícita (dentro de un gesto del
   * usuario). Devuelve `{ granted, reason }`. Al concederse, se libera el
   * stream de prueba; el motor pedirá el suyo sin volver a mostrar el diálogo.
   */
  async requestCameraPermission() {
    if (!this.isCameraAvailable()) {
      return { granted: false, reason: 'NO_CAMERA' }
    }
    applyNativeCameraPatch()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' } },
      })
      stream.getTracks().forEach((track) => track.stop())
      return { granted: true, reason: null }
    } catch (err) {
      const reason = classifyCameraError(err)
      this.recordEvent('SESSION_ERROR', {
        errorCategory: 'PERMISSION_ERROR',
        reason,
        detail: String((err && err.message) || err),
      })
      return { granted: false, reason }
    }
  }

  async start(canvas) {
    this.canvas = canvas
    if (!window.THREE) window.THREE = THREE
    applyNativeCameraPatch()

    try {
      await load8thWallEngine()
    } catch (err) {
      this.setState(WEBAR_STATES.FALLO_RECUPERABLE, {
        errorType: 'RESOURCE_ERROR',
        message: 'El motor 8th Wall no pudo cargarse. Puede consultar las condiciones en modo texto.',
      })
      this.recordEvent('SESSION_ERROR', { errorCategory: 'RESOURCE_ERROR', reason: 'XR8_NOT_LOADED' })
      return false
    }

    const XR8 = window.XR8
    if (this.imageTargets.length > 32) {
      throw new Error('8th Wall admite un máximo de 32 objetivos activos simultáneos (Sección 2.5.6).')
    }

    // La cámara requiere un contexto seguro (HTTPS o localhost) y soporte de
    // getUserMedia. Sin esto, la experiencia no puede arrancar y es mejor
    // informarlo de forma clara en lugar de quedarse en "Iniciando cámara…".
    if (!this.isCameraAvailable()) {
      this.setState(WEBAR_STATES.FALLO_RECUPERABLE, {
        errorType: 'PERMISSION_OR_CAMERA_ERROR',
        message: 'No se detectó una cámara disponible o el navegador no permite su uso. Para probar desde un celular se requiere HTTPS (usa un túnel tipo ngrok) o localhost.',
      })
      this.recordEvent('SESSION_ERROR', { errorCategory: 'PERMISSION_ERROR', reason: 'GET_USER_MEDIA_UNAVAILABLE' })
      return false
    }

    XR8.XrController.configure({
      disableWorldTracking: true,
      imageTargetData: this.imageTargets,
    })

    document.addEventListener('visibilitychange', this.visibilityHandler)

    // Pipeline mínimo para Image Tracking: renderizador de textura + escena
    // Three.js + controlador XR. Sin módulos de "carga" (XRExtras) que ralentizan
    // el arranque en móvil.
    const modules = [
      XR8.GlTextureRenderer.pipelineModule(),
      XR8.Threejs.pipelineModule(),
      XR8.XrController.pipelineModule(),
    ]
    modules.push(this.createCustomPipelineModule())

    XR8.addCameraPipelineModules(modules)

    this.recordEvent('SESSION_OPEN', { accessMechanism: 'QR_CODE' })

    // `allowedDevices: ANY` es imprescindible: por defecto el motor solo
    // admite MOBILE_AND_HEADSETS, por lo que la cámara de escritorio nunca
    // arranca si no se indica explícitamente.
    const runConfig = { canvas }
    if (XR8.XrConfig && typeof XR8.XrConfig.device === 'function') {
      runConfig.allowedDevices = XR8.XrConfig.device().ANY
    }
    // `runOnCameraStatusChange` avisa de fallos de cámara (sin cámara,
    // permiso denegado, contexto no seguro) para no quedarse en "Iniciando…".
    runConfig.runOnCameraStatusChange = ({ status, reason }) => {
      if (status !== 'failed') return
      this.setState(WEBAR_STATES.FALLO_RECUPERABLE, {
        errorType: 'PERMISSION_OR_CAMERA_ERROR',
        message: cameraPermissionMessage(reason),
      })
      this.recordEvent('SESSION_ERROR', { errorCategory: 'PERMISSION_ERROR', reason })
    }
    XR8.run(runConfig)
    this.running = true
    return true
  }

  isCameraAvailable() {
    return (
      typeof navigator !== 'undefined' &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function'
    )
  }

  createCustomPipelineModule() {
    const self = this
    return {
      name: 'paseo-aranjuez-image-tracking',
      onStart: () => {
        const { scene } = window.XR8.Threejs.xrScene()
        self.setupThreeScene(scene)
        self.recordEvent('CAMERA_READY', {})
      },
      onException: (error) => {
        self.setState(WEBAR_STATES.FALLO_RECUPERABLE, {
          errorType: 'PERMISSION_OR_CAMERA_ERROR',
          message: 'No se pudo acceder a la cámara. Revise los permisos del navegador o utilice la consulta alternativa.',
        })
        self.recordEvent('SESSION_ERROR', {
          errorCategory: 'PERMISSION_ERROR',
          detail: String(error && error.message ? error.message : error),
        })
      },
      listeners: [
        {
          event: 'reality.imagescanning',
          process: ({ detail }) => {
            self.scanningStartMs = performance.now()
            self.setState(WEBAR_STATES.BUSQUEDA, {
              targetsLoaded: detail && detail.imageTargets ? detail.imageTargets.length : self.imageTargets.length,
            })
            self.recordEvent('SCANNING_STARTED', {})
          },
        },
        { event: 'reality.imagefound', process: ({ detail }) => self.handleImageFound(detail) },
        { event: 'reality.imageupdated', process: ({ detail }) => self.handleImageUpdated(detail) },
        { event: 'reality.imagelost', process: ({ detail }) => self.handleImageLost(detail) },
      ],
    }
  }

  setupThreeScene(scene) {
    const THREE = window.THREE
    if (!THREE) return

    this.targetContainerGroup = new THREE.Group()
    this.targetContainerGroup.visible = false

    const content = this.campaign.content || this.campaign.contents?.[0] || {}
    const isVideo = content.media_mime_type?.startsWith('video/')

    if (isVideo) {
      const video = document.createElement('video')
      video.src = content.media_url
      video.muted = true
      video.playsInline = true
      video.loop = true
      video.crossOrigin = 'anonymous'
      this.mediaEl = video
      this.mediaTexture = new THREE.VideoTexture(video)
      this.mediaTexture.minFilter = THREE.LinearFilter
      this.mediaTexture.magFilter = THREE.LinearFilter
    } else {
      const texture = new THREE.TextureLoader().load(content.media_url, () => {
        this.resizePlaneToTexture(texture)
      })
      texture.minFilter = THREE.LinearFilter
      texture.magFilter = THREE.LinearFilter
      this.mediaTexture = texture
    }

    const material = new THREE.MeshBasicMaterial({ map: this.mediaTexture, side: THREE.DoubleSide, transparent: true })
    const geometry = new THREE.PlaneGeometry(1.0, 1.33)
    this.mediaPlane = new THREE.Mesh(geometry, material)
    this.targetContainerGroup.add(this.mediaPlane)
    scene.add(this.targetContainerGroup)
  }

  resizePlaneToTexture(texture) {
    if (!this.mediaPlane) return
    const img = texture.image
    if (img && img.width && img.height) {
      const ratio = img.height / img.width
      this.mediaPlane.scale.set(1.0, ratio / 1.33, 1.0)
    }
  }

  handleImageFound(detail) {
    const { name, position, rotation, scale } = detail
    this.isTargetCurrentlyTracked = true
    this.activeTargetMeta = { name }

    if (this.campaign.estado === 'VENCIDA') {
      this.setState(WEBAR_STATES.CONTENIDO_VISIBLE, {
        expiredCampaign: true,
        message: 'Esta campaña promocional de Paseo Aranjuez ha finalizado.',
      })
      this.recordEvent('TARGET_FOUND', { targetName: name, campaignExpired: true })
      return
    }

    this.applyPose(position, rotation, scale)
    if (this.targetContainerGroup) this.targetContainerGroup.visible = true

    if (this.mediaEl && typeof this.mediaEl.play === 'function') {
      const p = this.mediaEl.play()
      if (p && typeof p.catch === 'function') p.catch(() => {})
    }

    if (document.visibilityState === 'visible' && this.activeIntervalStartMs === null) {
      this.activeIntervalStartMs = performance.now()
    }

    if (!this.hasInitialRecognition) {
      this.hasInitialRecognition = true
      if (this.scanningStartMs !== null) {
        this.firstRecognitionLatencyMs = Math.round(performance.now() - this.scanningStartMs)
      }
      this.recordEvent('TARGET_FOUND', { targetName: name, timeToRecognitionMs: this.firstRecognitionLatencyMs })
      this.recordEvent('CONTENT_VIEWED', { targetName: name })
    } else {
      this.recordEvent('TARGET_RECOVERED', { targetName: name, episodeResume: true })
    }

    this.setState(WEBAR_STATES.CONTENIDO_VISIBLE, { targetName: name })
  }

  handleImageUpdated(detail) {
    const { position, rotation, scale } = detail
    this.applyPose(position, rotation, scale)
  }

  handleImageLost(detail) {
    this.isTargetCurrentlyTracked = false
    this.closeActiveTrackingInterval('IMAGE_LOST')
    this.lossCount += 1

    if (this.targetContainerGroup) this.targetContainerGroup.visible = false
    if (this.mediaEl && typeof this.mediaEl.pause === 'function' && !this.mediaEl.paused) {
      this.mediaEl.pause()
    }

    this.setState(WEBAR_STATES.RECUPERACION, {
      targetName: detail ? detail.name : null,
      instruction: 'Vuelva a enfocar el afiche del local dentro del recuadro para reanudar la experiencia.',
    })
    this.recordEvent('TARGET_LOST', { lossCount: this.lossCount })
  }

  applyPose(position, rotation, scale) {
    if (!this.targetContainerGroup || !position || !rotation) return
    this.targetContainerGroup.position.set(position.x, position.y, position.z)
    this.targetContainerGroup.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w)
    if (typeof scale === 'number') this.targetContainerGroup.scale.set(scale, scale, scale)
  }

  handleVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      this.closeActiveTrackingInterval('TAB_HIDDEN')
    } else if (document.visibilityState === 'visible' && this.isTargetCurrentlyTracked && this.activeIntervalStartMs === null) {
      this.activeIntervalStartMs = performance.now()
    }
  }

  closeActiveTrackingInterval(reason) {
    if (this.activeIntervalStartMs !== null) {
      const deltaMs = Math.max(0, Math.round(performance.now() - this.activeIntervalStartMs))
      this.visibleTrackingTotalMs += deltaMs
      this.activeIntervalStartMs = null
      this.recordEvent('TRACKING_INTERVAL_CLOSED', {
        intervalMs: deltaMs,
        accumulatedVisibleMs: this.visibleTrackingTotalMs,
        isTracked: reason !== 'UNTRACKED_GAP',
        isVisible: true,
        reason,
      })
    }
  }

  triggerCTA(label, ctaType = 'VER_CONDICIONES') {
    this.recordEvent('CTA_CLICK', { ctaType, ctaLabel: label })
  }

  stop() {
    if (!this.running) return
    this.closeActiveTrackingInterval('SESSION_STOP')
    document.removeEventListener('visibilitychange', this.visibilityHandler)

    if (this.mediaEl && typeof this.mediaEl.pause === 'function') {
      this.mediaEl.pause()
      if (this.mediaEl.tagName === 'VIDEO') {
        this.mediaEl.src = ''
        this.mediaEl.load()
      }
    }
    if (this.mediaTexture && typeof this.mediaTexture.dispose === 'function') {
      this.mediaTexture.dispose()
    }
    if (window.XR8 && typeof window.XR8.stop === 'function') {
      window.XR8.stop()
    }

    this.setState(WEBAR_STATES.FINALIZACION, { visibleTrackingTotalMs: this.visibleTrackingTotalMs })
    this.recordEvent('SESSION_CLOSE', { visibleTrackingTotalMs: this.visibleTrackingTotalMs, lossCount: this.lossCount }, true)
    this.running = false
  }

  recordEvent(eventType, payload = {}, useBeacon = false) {
    if (!this.telemetry) return null
    const campaignId = this.campaign.campaign_id || this.campaign.id
    const version = this.campaign.version || 1
    const eventRecord = {
      event_id: `evt_${this.sessionId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      session_id: this.sessionId,
      campaign_id: campaignId,
      campaign_version: version,
      target_id: this.activeTargetMeta ? this.activeTargetMeta.name : null,
      target_version: this.campaign.target_version || 1,
      event_type: eventType,
      payload,
      client_time: new Date().toISOString(),
      schema_version: '1.0.0',
    }

    this.onTelemetry(eventRecord)

    const body = JSON.stringify(eventRecord)
    if (useBeacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' })
      navigator.sendBeacon('/api/v1/events', blob)
    } else {
      api.ingestEvent(eventRecord).catch(() => {})
    }
    return eventRecord
  }
}

/* ============================================================================
 * CÁMARA NATIVA EN HD (cámara trasera + degradación elegante)
 * ============================================================================ */

let cameraPatchApplied = false

function applyNativeCameraPatch() {
  if (cameraPatchApplied) return
  if (typeof navigator === 'undefined') return
  const md = navigator.mediaDevices
  if (!md || typeof md.getUserMedia !== 'function') return
  cameraPatchApplied = true

  const original = md.getUserMedia.bind(md)
  md.getUserMedia = function (constraints) {
    if (!constraints || constraints.video === undefined) return original(constraints)
    return acquireWithFallback(original, constraints)
  }
}

/**
 * Intenta obtener el stream de cámara probando varias configuraciones, desde la
 * de mayor calidad (trasera 1920×1080 @30fps) hasta la más permisiva, para no
 * fallar nunca por una restricción no soportada.
 */
async function acquireWithFallback(original, constraints) {
  const video = constraints.video
  const base = video && typeof video === 'object' && !Array.isArray(video) ? { ...video } : {}

  const attempts = [
    { ...base, facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
    { ...base, facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    { ...base, facingMode: { ideal: 'environment' } },
    base,
  ]

  let lastError = null
  for (let i = 0; i < attempts.length; i++) {
    try {
      return await original({ ...constraints, video: attempts[i] })
    } catch (err) {
      lastError = err
      if (!isRetryableCameraError(err)) throw err
    }
  }
  // Último recurso: respetar exactamente lo que pidió el motor.
  return original(constraints)
}

function isRetryableCameraError(err) {
  const name = err && err.name ? err.name : ''
  return (
    name === 'OverconstrainedError' ||
    name === 'ConstraintNotSatisfiedError' ||
    name === 'NotFoundError' ||
    name === 'DevicesNotFoundError'
  )
}

function classifyCameraError(err) {
  const name = err && err.name ? err.name : ''
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return 'DENY_CAMERA'
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'NO_CAMERA'
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return 'CAMERA_BUSY'
  }
  return 'UNKNOWN'
}

export function cameraPermissionMessage(reason) {
  const messages = {
    DENY_CAMERA: 'Permiso de cámara denegado. Actívalo en los permisos del navegador y vuelve a intentarlo.',
    DENY_MICROPHONE: 'Permiso de micrófono denegado.',
    NO_CAMERA: 'No se detectó ninguna cámara en este dispositivo.',
    NOT_FOUND: 'No se detectó ninguna cámara en este dispositivo.',
    CAMERA_BUSY: 'La cámara está ocupada por otra aplicación. Ciérrala e inténtalo de nuevo.',
    UNKNOWN: 'No se pudo acceder a la cámara. Verifica los permisos del navegador o usa HTTPS (o localhost) desde un celular.',
  }
  return messages[reason] || messages.UNKNOWN
}
