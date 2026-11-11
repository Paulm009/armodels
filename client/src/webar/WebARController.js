/**
 * ============================================================================
 * CONTROLADOR WEBAR CON 8TH WALL (Image Tracking) - PASEO ARANJUEZ
 * Máquina de estados (Figura 2.1), jerarquía Three.js, telemetría sendBeacon.
 * Soporta contenido de tipo video (VideoTexture) o imagen (Texture).
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

  async start(canvas) {
    this.canvas = canvas
    if (!window.THREE) window.THREE = THREE

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

    XR8.XrController.configure({
      disableWorldTracking: true,
      imageTargetData: this.imageTargets,
    })

    document.addEventListener('visibilitychange', this.visibilityHandler)

    const modules = [XR8.GlTextureRenderer.pipelineModule(), XR8.Threejs.pipelineModule(), XR8.XrController.pipelineModule()]
    if (window.XRExtras) {
      if (XRExtrasLoadingAvailable()) {
        modules.unshift(
          window.XRExtras.AlmostThere.pipelineModule(),
          window.XRExtras.Loading.pipelineModule(),
          window.XRExtras.RuntimeError.pipelineModule()
        )
      }
    }
    modules.push(this.createCustomPipelineModule())

    XR8.addCameraPipelineModules(modules)

    this.recordEvent('SESSION_OPEN', { accessMechanism: 'QR_CODE' })
    XR8.run({ canvas })
    this.running = true
    return true
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

function XRExtrasLoadingAvailable() {
  return (
    window.XRExtras &&
    window.XRExtras.AlmostThere &&
    window.XRExtras.Loading &&
    window.XRExtras.RuntimeError
  )
}
