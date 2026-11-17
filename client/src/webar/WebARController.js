/**
 * ============================================================================
 * CONTROLADOR WEBAR CON 8TH WALL (Image Tracking) - PASEO ARANJUEZ
 *
 * Responsabilidades:
 *  - Ciclo de vida completo del motor (cargar, iniciar, detener, limpiar).
 *  - Cámara trasera y estado de cámara mediante onCameraStatusChange.
 *  - Máquina de estados de la experiencia (Figura 2.1).
 *  - Contenido por image target, con video compatible con iOS.
 *  - Telemetría con deduplicación, versión de campaña y target_id real.
 *
 * Requisitos del motor verificados en la documentación oficial:
 *  - HTTPS, WebGL, getUserMedia y WebAssembly SIMD.
 *  - Safari iOS 16.4+; WKWebView iOS 14.3+.
 *  - imagePath debe ser una URL descargable por el navegador.
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

const APP_VERSION = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_APP_VERSION) || '1.0.0'
const DEFAULT_TARGET_ASPECT = 480 / 640

export class WebARController {
  constructor({
    campaign,
    imageTargets,
    telemetry = true,
    accessMechanism = 'DIRECT_URL',
    onStateChange = () => {},
    onTelemetry = () => {},
    onPlaybackBlocked = () => {},
  }) {
    this.campaign = campaign || {}
    this.imageTargets = Array.isArray(imageTargets) ? imageTargets : []
    this.telemetry = telemetry
    this.accessMechanism = accessMechanism
    this.onStateChange = onStateChange
    this.onTelemetry = onTelemetry
    this.onPlaybackBlocked = onPlaybackBlocked

    this.state = WEBAR_STATES.PREPARACION
    this.sessionId = `ses_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    this.deviceInfo = getDeviceInfo()

    this.targetMap = new Map()
    this.primaryContent = this.resolvePrimaryContent()
    this.currentTargetName = null
    this.currentContentId = null
    this.activeTargetMeta = null
    this.hasInitialRecognition = false
    this.isTargetCurrentlyTracked = false
    this.activeIntervalStartMs = null
    this.visibleTrackingTotalMs = 0
    this.lossCount = 0
    this.scanningStartMs = null
    this.firstRecognitionLatencyMs = null
    this.scanningEventSent = false

    this.scene = null
    this.targetContainerGroup = null
    this.mediaPlane = null
    this.media = null
    this.mediaToken = 0

    this.canvas = null
    this.running = false
    this.starting = false
    this.stopped = false
    this.sessionOpened = false
    this.sessionClosed = false
    this.failed = false
    this.pipelineModuleName = `paseo-aranjuez-image-tracking-${Math.random().toString(36).slice(2, 6)}`

    this.visibilityHandler = this.handleVisibilityChange.bind(this)
    this.pageHideHandler = this.handlePageHide.bind(this)

    this.prepareTargets()
  }

  resolvePrimaryContent() {
    return this.campaign.content || (Array.isArray(this.campaign.contents) ? this.campaign.contents[0] : null) || null
  }

  prepareTargets() {
    for (const target of this.imageTargets) {
      if (!target || !target.name) continue
      const content = target.content || this.findContentForTarget(target) || this.primaryContent
      this.targetMap.set(target.name, {
        ...target,
        targetId: target.targetId || target.target_id || target.name,
        content,
      })
    }
  }

  findContentForTarget(target) {
    const contents = this.campaign.contents || []
    if (!contents.length) return null
    const dbId = target.targetDbId || target.db_id || target.id
    if (dbId) {
      const match = contents.find((content) => content.imagen_objetivo_id === dbId)
      if (match) return match
    }
    return contents.find((content) => content.target_id === target.targetId || content.target_id === target.name) || null
  }

  setState(nextState, details = {}) {
    if (this.stopped && nextState !== WEBAR_STATES.FINALIZACION) return
    this.state = nextState
    this.onStateChange(nextState, details)
  }

  /**
   * No adquiere un stream propio: solo consulta el permiso cuando el navegador
   * lo permite. Así el motor es el único que abre la cámara y se evita la
   * carrera "getUserMedia + stop + getUserMedia" en iOS/Android.
   */
  async requestCameraPermission() {
    if (!this.isCameraAvailable()) {
      return { granted: false, reason: 'NO_CAMERA' }
    }
    try {
      if (navigator.permissions && typeof navigator.permissions.query === 'function') {
        const status = await navigator.permissions.query({ name: 'camera' })
        if (status.state === 'denied') return { granted: false, reason: 'DENY_CAMERA' }
      }
    } catch {
      /* Safari y algunos webviews no soportan query({name:'camera'}). */
    }
    return { granted: true, reason: null }
  }

  async start(canvas) {
    if (this.running || this.starting) return false
    if (!canvas) {
      this.fail('NO_CANVAS', 'No se encontró el lienzo de cámara.')
      return false
    }
    if (typeof window !== 'undefined' && !window.isSecureContext && !isLocalhost(window.location.hostname)) {
      this.fail('INSECURE_CONTEXT', 'La cámara requiere HTTPS. Abre la experiencia desde una dirección https:// o localhost.')
      return false
    }
    if (!this.isCameraAvailable()) {
      this.fail('NO_CAMERA', 'No se detectó una cámara disponible o el navegador no permite su uso.')
      return false
    }
    if (!this.imageTargets.length) {
      this.fail('NO_TARGETS', 'La campaña no tiene una imagen objetivo activa. Consulta la promoción en modo texto.')
      return false
    }
    if (this.imageTargets.length > 32) {
      this.fail('TOO_MANY_TARGETS', '8th Wall admite un máximo de 32 objetivos activos simultáneos.')
      return false
    }

    this.canvas = canvas
    this.starting = true
    this.stopped = false
    this.failed = false
    if (window.THREE !== THREE) window.THREE = THREE

    this.setState(WEBAR_STATES.PREPARACION, { message: 'Cargando el motor de realidad aumentada…' })

    try {
      await load8thWallEngine({
        forceReload: false,
        onProgress: ({ message }) => {
          if (!this.stopped) this.setState(WEBAR_STATES.PREPARACION, { message })
        },
      })
    } catch (error) {
      this.fail('RESOURCE_ERROR', error.message || 'El motor 8th Wall no pudo cargarse.')
      return false
    }

    const XR8 = window.XR8
    if (!XR8 || !XR8.XrController) {
      this.fail('RESOURCE_ERROR', 'El motor de realidad aumentada no pudo inicializar el seguimiento de imágenes. Actualiza el navegador o inténtalo de nuevo.')
      return false
    }

    try {
      XR8.XrController.configure({
        disableWorldTracking: true,
        imageTargetData: this.buildEngineTargets(),
      })

      // Limpiar módulos de una sesión anterior evita duplicar la escena y que
      // la cámara quede bloqueada al reabrir la experiencia.
      if (typeof XR8.clearCameraPipelineModules === 'function') {
        XR8.clearCameraPipelineModules()
      }

      XR8.addCameraPipelineModules([
        XR8.GlTextureRenderer.pipelineModule(),
        XR8.Threejs.pipelineModule(),
        XR8.XrController.pipelineModule(),
        this.createCustomPipelineModule(),
      ])

      document.addEventListener('visibilitychange', this.visibilityHandler)
      window.addEventListener('pagehide', this.pageHideHandler)
      window.addEventListener('beforeunload', this.pageHideHandler)

      const runConfig = { canvas }
      if (XR8.XrConfig && typeof XR8.XrConfig.camera === 'function') {
        runConfig.cameraConfig = { direction: XR8.XrConfig.camera().BACK }
      }
      if (XR8.XrConfig && typeof XR8.XrConfig.device === 'function') {
        runConfig.allowedDevices = XR8.XrConfig.device().ANY
      }

      XR8.run(runConfig)
      if (this.stopped || this.failed) return false
      this.running = true
      this.starting = false
      this.sessionOpened = true
      this.recordEvent('SESSION_OPEN', { accessMechanism: this.accessMechanism })
      return true
    } catch (error) {
      this.fail('CAMERA_ERROR', `No se pudo iniciar la cámara: ${error && error.message ? error.message : error}`)
      return false
    }
  }

  buildEngineTargets() {
    return Array.from(this.targetMap.values()).map((target) => ({
      name: target.name,
      imagePath: absoluteUrl(target.imagePath),
      type: target.type || 'PLANAR',
      properties: target.properties || {},
      metadata: {
        ...(target.metadata || {}),
        targetId: target.targetId,
        contentId: target.content ? target.content.content_id : null,
      },
    }))
  }

  isCameraAvailable() {
    return typeof navigator !== 'undefined' && navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function'
  }

  createCustomPipelineModule() {
    const self = this
    return {
      name: this.pipelineModuleName,
      onStart: () => {
        if (self.stopped) return
        try {
          const { scene } = window.XR8.Threejs.xrScene()
          self.setupThreeScene(scene)
          self.recordEvent('CAMERA_READY', {})
          self.setState(WEBAR_STATES.BUSQUEDA, { message: 'Cámara lista. Enfoca el afiche para reconocerlo.' })
        } catch (error) {
          self.fail('SCENE_ERROR', `No se pudo preparar la escena AR: ${error.message}`)
        }
      },
      onCameraStatusChange: ({ status, reason }) => {
        if (status === 'failed') {
          const classified = self.classifyReason(reason)
          self.fail('PERMISSION_OR_CAMERA_ERROR', cameraPermissionMessage(classified), classified)
        } else if (status === 'requesting') {
          self.setState(WEBAR_STATES.PREPARACION, { message: 'Solicitando acceso a la cámara…' })
        } else if (status === 'hasStream') {
          self.setState(WEBAR_STATES.BUSQUEDA, { message: 'Cámara lista. Enfoca el afiche para reconocerlo.' })
        }
      },
      onException: (error) => {
        self.fail('CAMERA_ERROR', 'No se pudo acceder a la cámara. Revisa los permisos del navegador o usa la consulta alternativa.')
        self.recordEvent('SESSION_ERROR', {
          errorCategory: 'CAMERA_ERROR',
          detail: String(error && error.message ? error.message : error),
        })
      },
      listeners: [
        {
          event: 'reality.imagescanning',
          process: ({ detail }) => {
            if (!self.scanningEventSent) {
              self.scanningEventSent = true
              self.scanningStartMs = performance.now()
              self.recordEvent('SCANNING_STARTED', {})
            }
            self.setState(WEBAR_STATES.BUSQUEDA, {
              targetCount: detail && detail.imageTargets ? detail.imageTargets.length : self.imageTargets.length,
              message: 'Buscando el afiche…',
            })
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
    if (!THREE || !scene) return
    this.scene = scene

    if (this.targetContainerGroup) {
      this.disposeMedia()
      if (this.mediaPlane) {
        if (this.mediaPlane.geometry && this.mediaPlane.geometry.dispose) this.mediaPlane.geometry.dispose()
        if (this.mediaPlane.material && this.mediaPlane.material.dispose) this.mediaPlane.material.dispose()
      }
      scene.remove(this.targetContainerGroup)
      this.targetContainerGroup = null
      this.mediaPlane = null
    }

    this.targetContainerGroup = new THREE.Group()
    this.targetContainerGroup.visible = false

    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    this.mediaPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)
    this.mediaPlane.position.z = 0.01
    this.targetContainerGroup.add(this.mediaPlane)
    scene.add(this.targetContainerGroup)
  }

  async setActiveContent(target, force = false) {
    const content = (target && target.content) || this.primaryContent
    if (!content) {
      this.setState(WEBAR_STATES.FALLO_RECUPERABLE, {
        errorType: 'CONTENT_ERROR',
        message: 'La campaña no tiene contenido asociado para mostrar.',
        canRetry: false,
      })
      return
    }

    const contentId = content.content_id || content.media_url
    if (!force && this.currentContentId === contentId && this.media) {
      this.layoutPlane(target)
      return
    }

    this.disposeMedia()
    const token = ++this.mediaToken
    this.currentContentId = contentId

    const mediaType = getMediaType(content)
    const url = absoluteUrl(content.media_url)
    if (!url) {
      this.fail('CONTENT_ERROR', 'El contenido de la campaña no tiene una URL válida.')
      return
    }

    if (mediaType === 'video') {
      const video = document.createElement('video')
      video.src = url
      video.muted = true
      video.loop = true
      video.preload = 'auto'
      video.playsInline = true
      video.setAttribute('playsinline', 'true')
      video.setAttribute('webkit-playsinline', 'true')
      video.setAttribute('x5-playsinline', 'true')
      video.setAttribute('aria-hidden', 'true')
      video.crossOrigin = 'anonymous'
      video.style.cssText =
        'position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;'
      document.body.appendChild(video)
      video.load()

      const texture = new THREE.VideoTexture(video)
      texture.minFilter = THREE.LinearFilter
      texture.magFilter = THREE.LinearFilter
      this.media = { type: 'video', video, texture }
      this.applyTexture(texture)
      this.layoutPlane(target)

      try {
        await waitForMedia(video, 6000)
      } catch {
        /* la reproducción se intentará igualmente */
      }
      if (token !== this.mediaToken) return
      this.layoutPlane(target)
      if (this.isTargetCurrentlyTracked) {
        this.playMedia()
      }
      return
    }

    const texture = await loadTexture(url).catch((error) => {
      if (token === this.mediaToken) this.fail('CONTENT_ERROR', `No se pudo cargar la imagen del contenido: ${error.message}`)
      return null
    })
    if (!texture || token !== this.mediaToken) {
      if (texture && texture.dispose) texture.dispose()
      return
    }
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    this.media = { type: 'image', texture }
    this.applyTexture(texture)
    this.layoutPlane(target)
  }

  applyTexture(texture) {
    if (!this.mediaPlane) return
    const material = this.mediaPlane.material
    material.map = texture
    material.opacity = 1
    material.needsUpdate = true
  }

  layoutPlane(target) {
    if (!this.mediaPlane || !this.media) return
    const properties = (target && target.properties) || {}
    const targetAspect =
      properties.width && properties.height ? Number(properties.width) / Number(properties.height) : DEFAULT_TARGET_ASPECT
    const safeTargetAspect = Number.isFinite(targetAspect) && targetAspect > 0 ? targetAspect : DEFAULT_TARGET_ASPECT
    const targetWidth = 1
    const targetHeight = targetWidth / safeTargetAspect
    const contentAspect = getMediaAspect(this.media) || safeTargetAspect
    const margin = 0.96

    let width
    let height
    if (contentAspect >= safeTargetAspect) {
      width = targetWidth * margin
      height = width / contentAspect
    } else {
      height = targetHeight * margin
      width = height * contentAspect
    }
    this.mediaPlane.scale.set(width, height, 1)
  }

  async playMedia() {
    if (!this.media || this.media.type !== 'video' || !this.media.video) return
    try {
      await this.media.video.play()
      this.onPlaybackBlocked(false)
    } catch {
      this.onPlaybackBlocked(true)
      if (this.state === WEBAR_STATES.CONTENIDO_VISIBLE) {
        this.onStateChange(WEBAR_STATES.CONTENIDO_VISIBLE, {
          targetName: this.currentTargetName,
          content: this.targetMap.get(this.currentTargetName)?.content || this.primaryContent,
          needsPlay: true,
        })
      }
    }
  }

  handleImageFound(detail = {}) {
    const name = detail.name || this.currentTargetName
    const target = this.targetMap.get(name) || Array.from(this.targetMap.values())[0] || {
      name,
      targetId: name,
      content: this.primaryContent,
      properties: {},
    }

    this.isTargetCurrentlyTracked = true
    this.currentTargetName = target.name
    this.activeTargetMeta = {
      name: target.name,
      targetId: target.targetId,
      targetVersion: target.target_version || target.targetVersion || null,
    }

    if (this.campaign.estado === 'VENCIDA') {
      this.setState(WEBAR_STATES.CONTENIDO_VISIBLE, {
        expiredCampaign: true,
        message: 'Esta campaña promocional de Paseo Aranjuez ha finalizado.',
      })
      this.recordEvent('TARGET_FOUND', { targetId: target.targetId, targetName: target.name, campaignExpired: true })
      return
    }

    this.applyPose(detail)
    if (this.targetContainerGroup) this.targetContainerGroup.visible = true

    this.setActiveContent(target).catch((error) => {
      this.fail('CONTENT_ERROR', `No se pudo preparar el contenido: ${error.message}`)
    })
    if (this.media && this.media.type === 'video') {
      this.playMedia()
    }

    if (document.visibilityState === 'visible' && this.activeIntervalStartMs === null) {
      this.activeIntervalStartMs = performance.now()
    }

    if (!this.hasInitialRecognition) {
      this.hasInitialRecognition = true
      if (this.scanningStartMs !== null) {
        this.firstRecognitionLatencyMs = Math.round(performance.now() - this.scanningStartMs)
      }
      this.recordEvent('TARGET_FOUND', {
        targetId: target.targetId,
        targetName: target.name,
        timeToRecognitionMs: this.firstRecognitionLatencyMs,
      })
      this.recordEvent('CONTENT_VIEWED', { targetId: target.targetId, targetName: target.name })
    } else {
      this.recordEvent('TARGET_RECOVERED', { targetId: target.targetId, targetName: target.name, episodeResume: true })
    }

    this.setState(WEBAR_STATES.CONTENIDO_VISIBLE, {
      targetName: target.name,
      content: target.content || this.primaryContent,
      needsPlay: false,
    })
  }

  handleImageUpdated(detail = {}) {
    if (detail.name && this.currentTargetName && detail.name !== this.currentTargetName) {
      this.handleImageFound(detail)
      return
    }
    this.applyPose(detail)
  }

  handleImageLost(detail = {}) {
    this.isTargetCurrentlyTracked = false
    this.closeActiveTrackingInterval('IMAGE_LOST')
    this.lossCount += 1

    if (this.targetContainerGroup) this.targetContainerGroup.visible = false
    if (this.media && this.media.type === 'video' && this.media.video && !this.media.video.paused) {
      this.media.video.pause()
    }

    this.setState(WEBAR_STATES.RECUPERACION, {
      targetName: detail.name || this.currentTargetName,
      message: 'Vuelve a enfocar el afiche del local dentro del recuadro para reanudar la experiencia.',
    })
    this.recordEvent('TARGET_LOST', { targetId: this.activeTargetMeta?.targetId || null, lossCount: this.lossCount })
  }

  applyPose(detail = {}) {
    const { position, rotation, scale } = detail
    if (!this.targetContainerGroup || !position || !rotation) return
    this.targetContainerGroup.position.set(position.x, position.y, position.z)
    if (rotation.w !== undefined) {
      this.targetContainerGroup.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w)
    }
    if (typeof scale === 'number') this.targetContainerGroup.scale.set(scale, scale, scale)
    else if (scale && typeof scale.x === 'number') this.targetContainerGroup.scale.set(scale.x, scale.y, scale.z)
  }

  handleVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      this.closeActiveTrackingInterval('TAB_HIDDEN')
      if (this.media && this.media.type === 'video' && this.media.video) this.media.video.pause()
    } else if (this.isTargetCurrentlyTracked) {
      if (this.activeIntervalStartMs === null) this.activeIntervalStartMs = performance.now()
      this.playMedia()
    }
  }

  handlePageHide() {
    if (this.sessionClosed) return
    this.closeActiveTrackingInterval('PAGE_HIDE')
    this.recordEvent(
      'SESSION_CLOSE',
      {
        visibleTrackingTotalMs: this.visibleTrackingTotalMs,
        lossCount: this.lossCount,
        reason: 'PAGE_HIDE',
      },
      true
    )
    this.sessionClosed = true
    this.stop({ recordClose: false })
  }

  closeActiveTrackingInterval(reason) {
    if (this.activeIntervalStartMs === null) return
    const deltaMs = Math.max(0, Math.round(performance.now() - this.activeIntervalStartMs))
    this.visibleTrackingTotalMs += deltaMs
    this.activeIntervalStartMs = null
    this.recordEvent('TRACKING_INTERVAL_CLOSED', {
      intervalMs: deltaMs,
      accumulatedVisibleMs: this.visibleTrackingTotalMs,
      isTracked: true,
      isVisible: true,
      reason,
    })
  }

  triggerCTA(label, ctaType = 'VER_CONDICIONES') {
    this.recordEvent('CTA_CLICK', { ctaType, ctaLabel: label })
  }

  stop({ recordClose = true, preserveState = false } = {}) {
    if (this.stopped) return
    this.closeActiveTrackingInterval('SESSION_STOP')

    document.removeEventListener('visibilitychange', this.visibilityHandler)
    window.removeEventListener('pagehide', this.pageHideHandler)
    window.removeEventListener('beforeunload', this.pageHideHandler)

    this.disposeMedia()
    if (this.mediaPlane) {
      if (this.mediaPlane.geometry && this.mediaPlane.geometry.dispose) this.mediaPlane.geometry.dispose()
      if (this.mediaPlane.material && this.mediaPlane.material.dispose) this.mediaPlane.material.dispose()
    }
    if (this.targetContainerGroup && this.scene) {
      this.scene.remove(this.targetContainerGroup)
    }
    this.targetContainerGroup = null
    this.mediaPlane = null

    if (window.XR8) {
      try {
        if (typeof window.XR8.stop === 'function') window.XR8.stop()
      } catch {
        /* el motor puede no estar en ejecución */
      }
      try {
        if (typeof window.XR8.clearCameraPipelineModules === 'function') window.XR8.clearCameraPipelineModules()
      } catch {
        /* noop */
      }
    }

    this.running = false
    this.starting = false
    this.isTargetCurrentlyTracked = false
    this.stopped = true

    if (recordClose && !this.sessionClosed && this.sessionOpened) {
      this.sessionClosed = true
      this.recordEvent(
        'SESSION_CLOSE',
        {
          visibleTrackingTotalMs: this.visibleTrackingTotalMs,
          lossCount: this.lossCount,
          reason: 'SESSION_STOP',
        },
        true
      )
    } else {
      this.sessionClosed = true
    }

    if (!preserveState) {
      this.setState(WEBAR_STATES.FINALIZACION, { visibleTrackingTotalMs: this.visibleTrackingTotalMs })
    }
  }

  disposeMedia() {
    this.mediaToken += 1
    if (!this.media) return
    const media = this.media
    this.media = null
    if (media.video) {
      try {
        media.video.pause()
        media.video.removeAttribute('src')
        media.video.load()
        if (media.video.parentNode) media.video.parentNode.removeChild(media.video)
      } catch {
        /* noop */
      }
    }
    if (media.texture && typeof media.texture.dispose === 'function') {
      media.texture.dispose()
    }
    if (this.mediaPlane && this.mediaPlane.material) {
      this.mediaPlane.material.map = null
      this.mediaPlane.material.opacity = 0
      this.mediaPlane.material.needsUpdate = true
    }
    this.currentContentId = null
  }

  fail(errorType, message, reason = null) {
    this.failed = true
    this.setState(WEBAR_STATES.FALLO_RECUPERABLE, {
      errorType,
      message,
      reason,
      canRetry: errorType !== 'NO_TARGETS',
    })
    this.recordEvent('SESSION_ERROR', { errorCategory: errorType, reason, message })
    if (this.running || this.starting) {
      this.stop({ recordClose: true, preserveState: true })
    }
  }

  classifyReason(reason) {
    const name = String(reason || '')
    if (/denied|notallowed|permission/i.test(name)) return 'DENY_CAMERA'
    if (/notfound|nodevice/i.test(name)) return 'NO_CAMERA'
    if (/notreadable|trackstart|abort|busy/i.test(name)) return 'CAMERA_BUSY'
    return name || 'UNKNOWN'
  }

  recordEvent(eventType, payload = {}, useBeacon = false) {
    if (!this.telemetry) return null
    const campaignId = this.campaign.campaign_id || this.campaign.id
    const version = this.campaign.version || 1
    const eventRecord = {
      event_id: `evt_${this.sessionId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      session_id: this.sessionId,
      campaign_id: campaignId,
      campaign_version: version,
      target_id: this.activeTargetMeta ? this.activeTargetMeta.targetId : null,
      target_version: this.activeTargetMeta?.targetVersion || this.campaign.target_version || null,
      event_type: eventType,
      payload,
      client_time: new Date().toISOString(),
      schema_version: '1.1.0',
      device_family: this.deviceInfo.deviceFamily,
      user_agent: this.deviceInfo.userAgent,
      engine_version: this.getEngineVersion(),
      app_version: APP_VERSION,
    }

    this.onTelemetry(eventRecord)

    const body = JSON.stringify(eventRecord)
    if (useBeacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      try {
        const blob = new Blob([body], { type: 'application/json' })
        navigator.sendBeacon('/api/v1/events', blob)
      } catch {
        api.ingestEvent(eventRecord, { keepalive: true }).catch(() => {})
      }
    } else {
      api.ingestEvent(eventRecord, { keepalive: true }).catch(() => {})
    }
    return eventRecord
  }

  getEngineVersion() {
    try {
      if (window.XR8 && typeof window.XR8.version === 'function') return window.XR8.version()
    } catch {
      /* noop */
    }
    return 'open-source-0.1.0'
  }
}

/* ============================================================================
 * Utilidades de contenido y cámara
 * ============================================================================ */

function getMediaType(content) {
  const mime = content.media_mime_type || content.mediaMimeType || ''
  if (mime.startsWith('video/')) return 'video'
  const url = String(content.media_url || content.mediaUrl || '').toLowerCase()
  if (/\.(mp4|m4v|webm)(\?|#|$)/.test(url)) return 'video'
  return 'image'
}

function getMediaAspect(media) {
  if (!media) return null
  if (media.type === 'video' && media.video) {
    const { videoWidth, videoHeight } = media.video
    if (videoWidth && videoHeight) return videoWidth / videoHeight
    return null
  }
  const image = media.texture && media.texture.image
  if (image && image.width && image.height) return image.width / image.height
  return null
}

function absoluteUrl(value) {
  if (!value) return ''
  if (typeof value !== 'string') return ''
  if (/^(https?:|data:|blob:)/i.test(value)) return value
  if (typeof window === 'undefined') return value
  return new URL(value.startsWith('/') ? value : `/${value}`, window.location.origin).href
}

function loadTexture(url) {
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader()
    loader.setCrossOrigin('anonymous')
    loader.load(url, resolve, undefined, () => reject(new Error('No se pudo descargar la imagen.')))
  })
}

function waitForMedia(video, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 2) return resolve(video)
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Tiempo de espera agotado al preparar el video.'))
    }, timeoutMs)
    const onReady = () => {
      cleanup()
      resolve(video)
    }
    const onError = () => {
      cleanup()
      reject(new Error('El navegador no pudo decodificar el video.'))
    }
    const cleanup = () => {
      clearTimeout(timer)
      video.removeEventListener('loadeddata', onReady)
      video.removeEventListener('canplay', onReady)
      video.removeEventListener('error', onError)
    }
    video.addEventListener('loadeddata', onReady)
    video.addEventListener('canplay', onReady)
    video.addEventListener('error', onError)
  })
}

function isLocalhost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function getDeviceInfo() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  let deviceFamily = 'desktop'
  if (/iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    deviceFamily = 'iOS'
  } else if (/Android/i.test(ua)) {
    deviceFamily = 'Android'
  }
  return { deviceFamily, userAgent: ua }
}

export function cameraPermissionMessage(reason) {
  const messages = {
    DENY_CAMERA:
      'Permiso de cámara denegado. Actívalo en los permisos del navegador (o en Ajustes del sistema) y vuelve a intentarlo.',
    DENY_MICROPHONE: 'Permiso de micrófono denegado.',
    NO_CAMERA: 'No se detectó ninguna cámara en este dispositivo.',
    NOT_FOUND: 'No se detectó ninguna cámara en este dispositivo.',
    CAMERA_BUSY: 'La cámara está ocupada por otra aplicación. Ciérrala e inténtalo de nuevo.',
    UNKNOWN:
      'No se pudo acceder a la cámara. Verifica los permisos del navegador, que la página use HTTPS y que el dispositivo tenga cámara.',
  }
  return messages[reason] || messages.UNKNOWN
}
