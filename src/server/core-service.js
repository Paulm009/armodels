/**
 * ============================================================================
 * SERVICIO DE APLICACIÓN Y ANALÍTICA DE CAMPAÑAS - PASEO ARANJUEZ
 * Backend funcional respaldado por Prisma (SQLite + migraciones).
 * Implementa OE1, OE2, OE3, OE6 y OE7 (Secciones 2.6 a 2.11 del Marco Teórico).
 * ============================================================================
 */
const path = require('path')
const fs = require('fs')
const { getPrismaClient } = require('./db')

const ALLOWED_ROLES_FOR_MUTATION = new Set(['DIRECCION_MARKETING', 'GERENCIA'])
const ALLOWED_MIME_SIGNATURES = {
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'video/mp4': [0x00, 0x00, 0x00], // ftyp box offset check
}

const CAMPAIGN_STATES = ['EN_PREPARACION', 'PUBLICADA', 'ARCHIVADA', 'VENCIDA']
const TARGETS_DIR = path.resolve(__dirname, '..', '..', 'image-targets')

function parseDate(value) {
  if (value instanceof Date) return value
  if (typeof value === 'string' && value) {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) return d
  }
  return null
}

function toISODate(date) {
  if (!date) return null
  const d = parseDate(date)
  return d ? d.toISOString().slice(0, 10) : null
}

class PaseoAranjuezCoreService {
  constructor(prismaClient = null) {
    this.prisma = prismaClient || getPrismaClient()
  }

  /**
   * Control de autorización RBAC en cada operación (Sección 2.10.1 OWASP)
   */
  authorizeAdminOperation(userRole, operationName) {
    if (!ALLOWED_ROLES_FOR_MUTATION.has(userRole)) {
      const err = new Error(`Acceso denegado (403): El rol '${userRole}' no está autorizado para ejecutar '${operationName}'.`)
      err.statusCode = 403
      throw err
    }
    return true
  }

  /**
   * Validación de archivos de imagen y video (Sección 2.10.2 OWASP)
   */
  validateUploadedAsset({ filename, mimeType, sizeBytes, magicBytes, width, height, contrastScore }) {
    const maxBytes = 15 * 1024 * 1024 // 15 MB
    if (!sizeBytes || sizeBytes <= 0 || sizeBytes > maxBytes) {
      throw new Error(`Tamaño de archivo inválido (${sizeBytes} bytes). Límite máximo: 15 MB.`)
    }
    if (!ALLOWED_MIME_SIGNATURES[mimeType]) {
      throw new Error(`Tipo MIME no permitido: ${mimeType}.`)
    }
    const expectedSig = ALLOWED_MIME_SIGNATURES[mimeType]
    if (Array.isArray(magicBytes)) {
      const matches = expectedSig.every((byte, idx) => magicBytes[idx] === byte)
      if (!matches) {
        throw new Error(`La firma binaria del archivo '${filename}' no coincide con el tipo declarado (${mimeType}).`)
      }
    }
    if (mimeType.startsWith('image/')) {
      if (width < 480 || height < 640) {
        throw new Error(`Resolución insuficiente (${width}x${height}). 8th Wall Image Target CLI requiere al menos 480x640 px.`)
      }
      if (typeof contrastScore === 'number' && contrastScore < 35) {
        throw new Error(`Contraste visual insuficiente (${contrastScore}/100). Se recomienda detalle variado y alto contraste (Sección 2.3.5).`)
      }
    }
    const safeName = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase()
    return { valid: true, safeFilename: `${Date.now()}_${safeName}` }
  }

  /* ==================== LOCALES ==================== */

  async registerLocal(localData, userRole = 'DIRECCION_MARKETING') {
    this.authorizeAdminOperation(userRole, 'registerLocal')
    if (!localData.nombre || !localData.rubro) {
      throw new Error('Datos obligatorios del local incompletos.')
    }
    return this.prisma.local.create({
      data: {
        nombre: localData.nombre,
        rubro: localData.rubro,
        ubicacion: localData.ubicacion || 'Planta baja',
        whatsapp: localData.contacto_whatsapp || localData.whatsapp || '',
        descripcion: localData.descripcion || null,
        activo: localData.activo !== false,
      },
    })
  }

  async listLocales() {
    const locales = await this.prisma.local.findMany({
      orderBy: { nombre: 'asc' },
      include: { _count: { select: { campanas: true } } },
    })
    return locales.map((l) => ({
      ...l,
      campanasCount: l._count.campanas,
      _count: undefined,
    }))
  }

  async updateLocal(id, data, userRole = 'DIRECCION_MARKETING') {
    this.authorizeAdminOperation(userRole, 'updateLocal')
    return this.prisma.local.update({
      where: { id },
      data: {
        nombre: data.nombre,
        rubro: data.rubro,
        ubicacion: data.ubicacion,
        whatsapp: data.whatsapp,
        descripcion: data.descripcion,
      },
    })
  }

  /* ==================== CAMPAÑAS ==================== */

  /**
   * Crea o publica una campaña verificando integridad transaccional:
   * - No permite publicar una campaña vencida (Sección 2.11.1)
   * - No permite publicar sin imagen objetivo o sin contenido (Sección 2.6.5)
   */
  async saveCampaign(campaignInput, userRole = 'DIRECCION_MARKETING', referenceDateStr = null) {
    this.authorizeAdminOperation(userRole, 'saveCampaign')
    const {
      campaign_id,
      local_id,
      nombre,
      estado = 'EN_PREPARACION',
      fecha_inicio,
      fecha_fin,
      target,
      content,
    } = campaignInput

    if (!campaign_id || !local_id || !nombre) {
      throw new Error('Datos obligatorios de la campaña incompletos.')
    }
    if (!CAMPAIGN_STATES.includes(estado)) {
      throw new Error(`Estado de campaña inválido: ${estado}.`)
    }

    const local = await this.prisma.local.findUnique({ where: { id: local_id } })
    if (!local) {
      const err = new Error(`El local comercial '${local_id}' no existe.`)
      err.statusCode = 400
      throw err
    }

    const inicio = parseDate(fecha_inicio)
    const fin = parseDate(fecha_fin)
    if (!inicio || !fin) {
      throw new Error('Las fechas de vigencia son obligatorias.')
    }
    if (fin < inicio) {
      throw new Error('La fecha de fin no puede ser anterior a la fecha de inicio.')
    }

    const referenceDate = referenceDateStr ? parseDate(referenceDateStr) : new Date()
    if (estado === 'PUBLICADA') {
      if (fin < referenceDate) {
        throw new Error('No se puede publicar una campaña cuya fecha de vigencia ya ha vencido (Sección 2.11.1).')
      }
      if (!target || !target.target_id || !target.image_path && !target.imagePath) {
        throw new Error('Transacción rechazada (Sección 2.6.5): No se puede publicar una campaña sin su Imagen Objetivo.')
      }
      if (!content || !content.media_url && !content.mediaUrl || !content.condiciones_texto && !content.condicionesTexto) {
        throw new Error('Transacción rechazada (Sección 2.6.5): No se puede publicar una campaña sin su contenido y condiciones accesibles.')
      }
    }

    const count = await this.prisma.campana.count({ where: { campaignId: campaign_id } })
    const nextVersion = count + 1

    const t = target || {}
    const c = content || {}
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(t.nombre_tecnico || t.name || 'target')) {
      throw new Error('Nombre técnico de imagen objetivo inválido.')
    }

    const campana = await this.prisma.campana.create({
      data: {
        campaignId: campaign_id,
        version: nextVersion,
        localId: local_id,
        nombre,
        estado,
        fechaInicio: inicio,
        fechaFin: fin,
        creadoPor: campaignInput.creado_por || null,
        aprobadoPor: campaignInput.aprobado_por || null,
      },
    })

    const objetivo = await this.prisma.imagenObjetivo.create({
      data: {
        targetId: t.target_id || `${campaign_id}-target`,
        version: nextVersion,
        campanaId: campana.id,
        nombreTecnico: t.nombre_tecnico || t.name || 'target',
        imagePath: t.image_path || t.imagePath || '',
        thumbnailPath: t.thumbnail_path || t.thumbnailPath || '',
        originalPath: t.original_path || t.originalPath || '',
        propertiesJson: JSON.stringify(t.properties || {}),
        contrastScore: t.contrast_score ?? t.contrastScore ?? 80,
        qrAccessUrl: t.qr_access_url || t.qrAccessUrl || '',
      },
    })

    await this.prisma.contenido.create({
      data: {
        campanaId: campana.id,
        imagenObjetivoId: objetivo.id,
        tipoContenido: c.tipo_contenido || c.tipoContenido || 'PANEL_INFORMATIVO',
        mediaUrl: c.media_url || c.mediaUrl || '',
        mediaSizeBytes: c.media_size_bytes ?? c.mediaSizeBytes ?? 1024,
        mediaMimeType: c.media_mime_type || c.mediaMimeType || 'image/png',
        tituloPromocion: c.titulo_promocion || c.tituloPromocion || nombre,
        condicionesTexto: c.condiciones_texto || c.condicionesTexto || '',
        ctaPrimariaLabel: c.cta_primaria_label || c.ctaPrimariaLabel || 'Ver condiciones',
        ctaSecundariaLabel: c.cta_secundaria_label || c.ctaSecundariaLabel || 'Consultar al local',
        ctaSecundariaUrl: c.cta_secundaria_url || c.ctaSecundariaUrl || '',
        overlayConfig: c.overlay_config ? JSON.stringify(c.overlay_config) : null,
      },
    })

    return this.getCampaignById(campaign_id, nextVersion)
  }

  async getCampaignById(campaignId, version = null) {
    const where = { campaignId }
    if (version !== null) where.version = version
    const campanas = await this.prisma.campana.findMany({
      where,
      orderBy: { version: 'desc' },
      include: { local: true, imagenes: true, contenidos: true },
    })
    if (campanas.length === 0) return null
    return serializeCampaign(campanas[0])
  }

  async listCampaigns({ latestOnly = true } = {}) {
    const campanas = await this.prisma.campana.findMany({
      orderBy: [{ campaignId: 'asc' }, { version: 'desc' }],
      include: { local: true, imagenes: true, contenidos: true },
    })
    const serialized = campanas.map(serializeCampaign)
    if (!latestOnly) return serialized
    const latest = new Map()
    for (const c of serialized) {
      if (!latest.has(c.campaign_id)) latest.set(c.campaign_id, c)
    }
    return Array.from(latest.values())
  }

  async listCampaignVersions(campaignId) {
    const campanas = await this.prisma.campana.findMany({
      where: { campaignId },
      orderBy: { version: 'desc' },
      include: { local: true, imagenes: true, contenidos: true },
    })
    return campanas.map(serializeCampaign)
  }

  async getActiveCampaignForVisitor(campaignId, referenceDateStr = null) {
    const versions = await this.listCampaignVersions(campaignId)
    if (!versions.length) {
      return { found: false, status: 'NOT_FOUND', message: 'Campaña no registrada.' }
    }
    const latest = versions[0]
    const referenceDate = referenceDateStr ? parseDate(referenceDateStr) : new Date()
    const fechaFin = parseDate(latest.fecha_fin)

    if (latest.estado === 'VENCIDA' || (fechaFin && fechaFin < referenceDate)) {
      return {
        found: true,
        status: 'EXPIRED',
        campaign: { ...latest, estado: 'VENCIDA' },
        showPromotionalMedia: false,
        message: 'Esta promoción de Paseo Aranjuez ha finalizado. Consulte las promociones vigentes del local.',
      }
    }
    if (latest.estado !== 'PUBLICADA') {
      return {
        found: true,
        status: 'NOT_PUBLISHED',
        campaign: latest,
        showPromotionalMedia: false,
        message: 'La campaña aún no se encuentra publicada.',
      }
    }

    const imageTargetData = latest.targets.map((target) => this.readTargetMetadata(target))
    return {
      found: true,
      status: 'ACTIVE',
      campaign: latest,
      showPromotionalMedia: true,
      imageTargetData,
    }
  }

  readTargetMetadata(target) {
    const name = target.nombre_tecnico || target.target_id
    if (typeof name !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(name)) {
      throw new Error('Nombre técnico de imagen objetivo inválido.')
    }
    const filePath = path.join(TARGETS_DIR, `${name}.json`)
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      return { ...raw, name: raw.name || name }
    } catch {
      // Reconstrucción mínima a partir del registro persistido
      return {
        imagePath: target.image_path,
        name,
        type: 'PLANAR',
        properties: safeParseJson(target.properties_json, {}),
        resources: {
          originalImage: path.basename(target.original_path || ''),
          thumbnailImage: path.basename(target.thumbnail_path || ''),
          luminanceImage: path.basename(target.image_path || ''),
        },
      }
    }
  }

  /* ==================== EVENTOS / TELEMETRÍA ==================== */

  /**
   * Registra un evento validando el contrato y aplicando deduplicación
   * idempotente por event_id (Sección 2.8.4 y 2.11.3).
   */
  async ingestEvent(eventInput) {
    if (!eventInput || typeof eventInput !== 'object' || Array.isArray(eventInput)) {
      throw new Error('Contrato de evento inválido.')
    }
    const requiredFields = ['event_id', 'session_id', 'campaign_id', 'campaign_version', 'event_type', 'client_time']
    for (const field of requiredFields) {
      if (eventInput[field] === undefined || eventInput[field] === null || eventInput[field] === '') {
        throw new Error(`Contrato de evento inválido: falta el campo obligatorio '${field}'.`)
      }
    }
    for (const field of ['event_id', 'session_id', 'campaign_id', 'event_type']) {
      if (typeof eventInput[field] !== 'string' || eventInput[field].length > 160) {
        throw new Error(`Contrato de evento inválido: campo '${field}'.`)
      }
    }
    if (!Number.isSafeInteger(eventInput.campaign_version) || eventInput.campaign_version < 1 ||
        typeof eventInput.client_time !== 'string' || !parseDate(eventInput.client_time) ||
        JSON.stringify(eventInput.payload || {}).length > 8192) {
      throw new Error('Contrato de evento inválido: versión, fecha o tamaño del contenido.')
    }

    const existing = await this.prisma.evento.findUnique({ where: { eventId: eventInput.event_id } })
    if (existing) {
      return { deduplicated: true, event: serializeEvent(existing) }
    }

    await this.prisma.sesion.upsert({
      where: { sessionId: eventInput.session_id },
      update: {},
      create: {
        sessionId: eventInput.session_id,
        campaignId: eventInput.campaign_id,
        campaignVersion: eventInput.campaign_version,
        accessMechanism: (eventInput.payload && eventInput.payload.accessMechanism) || 'QR_CODE',
        deviceFamily: eventInput.device_family || 'unknown',
        cameraReady: eventInput.event_type === 'CAMERA_READY',
        scanningStarted: eventInput.event_type === 'SCANNING_STARTED',
        startedAt: parseDate(eventInput.client_time) || new Date(),
      },
    })

    const stored = await this.prisma.evento.create({
      data: {
        eventId: eventInput.event_id,
        sessionId: eventInput.session_id,
        campaignId: eventInput.campaign_id,
        campaignVersion: eventInput.campaign_version,
        targetId: eventInput.target_id || null,
        targetVersion: eventInput.target_version || null,
        eventType: eventInput.event_type,
        payload: JSON.stringify(eventInput.payload || {}),
        clientTime: parseDate(eventInput.client_time) || new Date(),
        schemaVersion: eventInput.schema_version || '1.0.0',
      },
    })

    if (eventInput.event_type === 'SESSION_CLOSE') {
      await this.prisma.sesion.update({
        where: { sessionId: eventInput.session_id },
        data: { endedAt: new Date() },
      })
    }

    return { deduplicated: false, event: serializeEvent(stored) }
  }

  /**
   * Calcula los 7 indicadores operativos (Tabla 2.7), informando denominador y
   * devolviendo 'No calculable (N/C)' cuando el denominador es 0.
   */
  async computeCampaignMetrics(campaignId, campaignVersion = null) {
    const where = { campaignId }
    if (campaignVersion !== null) where.campaignVersion = campaignVersion
    const eventos = await this.prisma.evento.findMany({ where, orderBy: { clientTime: 'asc' } })
    const events = eventos.map(serializeEvent)
    return computeMetricsFromEvents(campaignId, campaignVersion, events)
  }

  async listReports() {
    const campanas = await this.prisma.campana.findMany({
      orderBy: [{ campaignId: 'asc' }, { version: 'desc' }],
      include: { local: true },
    })
    const reports = []
    for (const c of campanas) {
      const metrics = await this.computeCampaignMetrics(c.campaignId, c.version)
      reports.push({
        campaignId: c.campaignId,
        title: c.nombre,
        version: c.version,
        estado: c.estado,
        mode: 'CAMERA',
        sessions: metrics.indicators.sesionesConReconocimiento.denominator,
        recognized: metrics.indicators.sesionesConReconocimiento.value,
        trackingSec: metrics.indicators.seguimientoVisibleSegundos.valueSec,
        ctaClicks: metrics.indicators.sesionesConCTA.numerator,
        errors: metrics.indicators.tasaErrorDeSesion.numerator,
      })
    }
    return reports
  }
}

/* ==================== SERIALIZACIÓN ==================== */

function safeParseJson(str, fallback) {
  if (str === null || str === undefined) return fallback
  if (typeof str !== 'string') return str
  try {
    return JSON.parse(str)
  } catch {
    return fallback
  }
}

function serializeEvent(e) {
  return {
    event_id: e.eventId,
    session_id: e.sessionId,
    campaign_id: e.campaignId,
    campaign_version: e.campaignVersion,
    target_id: e.targetId,
    target_version: e.targetVersion,
    event_type: e.eventType,
    payload: safeParseJson(e.payload, {}),
    client_time: e.clientTime ? e.clientTime.toISOString() : null,
    received_at: e.receivedAt ? e.receivedAt.toISOString() : null,
    schema_version: e.schemaVersion,
  }
}

function serializeCampaign(c) {
  const targets = (c.imagenes || []).map((t) => ({
    target_id: t.targetId,
    target_version: t.version,
    nombre_tecnico: t.nombreTecnico,
    image_path: t.imagePath,
    thumbnail_path: t.thumbnailPath,
    original_path: t.originalPath,
    properties: safeParseJson(t.propertiesJson, {}),
    contrast_score: t.contrastScore,
    qr_access_url: t.qrAccessUrl,
  }))
  const contents = (c.contenidos || []).map((ct) => ({
    content_id: ct.id,
    tipo_contenido: ct.tipoContenido,
    media_url: ct.mediaUrl,
    media_size_bytes: ct.mediaSizeBytes,
    media_mime_type: ct.mediaMimeType,
    titulo_promocion: ct.tituloPromocion,
    condiciones_texto: ct.condicionesTexto,
    cta_primaria_label: ct.ctaPrimariaLabel,
    cta_secundaria_label: ct.ctaSecundariaLabel,
    cta_secundaria_url: ct.ctaSecundariaUrl,
    overlay_config: safeParseJson(ct.overlayConfig, null),
  }))
  const primaryContent = contents[0] || null
  return {
    id: c.id,
    campaign_id: c.campaignId,
    version: c.version,
    local_id: c.localId,
    local: c.local ? { id: c.local.id, nombre: c.local.nombre, rubro: c.local.rubro, ubicacion: c.local.ubicacion } : null,
    nombre: c.nombre,
    estado: c.estado,
    fecha_inicio: toISODate(c.fechaInicio),
    fecha_fin: toISODate(c.fechaFin),
    targets,
    contents,
    content: primaryContent,
  }
}

/* ==================== MÉTRICAS (Tabla 2.7) ==================== */

function computeMetricsFromEvents(campaignId, campaignVersion, events) {
  const sessionsMap = new Map()
  for (const ev of events) {
    if (!sessionsMap.has(ev.session_id)) sessionsMap.set(ev.session_id, [])
    sessionsMap.get(ev.session_id).push(ev)
  }

  let totalSessionsInitiated = 0
  let sessionsWithCameraAndScan = 0
  let sessionsWithRecognition = 0
  let sessionsWithContentShown = 0
  let sessionsWithCtaClick = 0
  let sessionsWithError = 0
  let totalVisibleTrackingMs = 0
  let totalLosses = 0
  const recognitionLatenciesMs = []

  for (const [, sessionEvents] of sessionsMap.entries()) {
    totalSessionsInitiated += 1
    const types = new Set(sessionEvents.map((e) => e.event_type))

    if (types.has('CAMERA_READY') || types.has('SCANNING_STARTED')) sessionsWithCameraAndScan += 1

    const foundEvents = sessionEvents.filter((e) => e.event_type === 'TARGET_FOUND')
    if (foundEvents.length > 0) {
      sessionsWithRecognition += 1
      const first = foundEvents[0]
      const latency = first.payload && typeof first.payload.timeToRecognitionMs === 'number'
        ? first.payload.timeToRecognitionMs
        : null
      if (latency !== null) recognitionLatenciesMs.push(latency)
    }

    if (types.has('CONTENT_VIEWED')) sessionsWithContentShown += 1
    if (types.has('CTA_CLICK')) sessionsWithCtaClick += 1
    if (types.has('SESSION_ERROR')) sessionsWithError += 1

    for (const ev of sessionEvents) {
      if (ev.event_type === 'TRACKING_INTERVAL_CLOSED' && ev.payload) {
        if (ev.payload.isTracked !== false && ev.payload.isVisible !== false) {
          totalVisibleTrackingMs += Number(ev.payload.intervalMs || 0)
        }
      }
      if (ev.event_type === 'TARGET_LOST') totalLosses += 1
    }
  }

  const formatRate = (num, den) => {
    if (!den || den === 0) {
      return { value: null, formatted: 'No calculable (N/C)', numerator: num, denominator: den }
    }
    const pct = Number(((num / den) * 100).toFixed(2))
    return { value: pct, formatted: `${pct}% (${num}/${den})`, numerator: num, denominator: den }
  }

  const avgLatencyMs = recognitionLatenciesMs.length > 0
    ? Math.round(recognitionLatenciesMs.reduce((a, b) => a + b, 0) / recognitionLatenciesMs.length)
    : null

  const visibleMinutes = totalVisibleTrackingMs / 60000
  const lossesPerMinute = visibleMinutes > 0 ? Number((totalLosses / visibleMinutes).toFixed(2)) : null

  return {
    campaign_id: campaignId,
    campaign_version: campaignVersion,
    uniqueEventsCount: events.length,
    indicators: {
      sesionesConReconocimiento: {
        value: sessionsWithRecognition,
        denominator: totalSessionsInitiated,
        formatted: `${sessionsWithRecognition} sesiones (de ${totalSessionsInitiated} iniciadas)`,
      },
      tasaReconocimientoPorSesion: formatRate(sessionsWithRecognition, sessionsWithCameraAndScan),
      tiempoHastaReconocimientoMs: {
        value: avgLatencyMs,
        formatted: avgLatencyMs !== null ? `${(avgLatencyMs / 1000).toFixed(2)} s (${avgLatencyMs} ms)` : 'No calculable (N/C)',
        samples: recognitionLatenciesMs.length,
      },
      seguimientoVisibleSegundos: {
        valueMs: totalVisibleTrackingMs,
        valueSec: Number((totalVisibleTrackingMs / 1000).toFixed(2)),
        formatted: `${(totalVisibleTrackingMs / 1000).toFixed(2)} s acumulados`,
      },
      sesionesConCTA: formatRate(sessionsWithCtaClick, sessionsWithContentShown),
      frecuenciaDePerdidas: {
        totalLosses,
        lossesPerEpisode: sessionsWithRecognition > 0 ? Number((totalLosses / sessionsWithRecognition).toFixed(2)) : null,
        lossesPerMinute,
        formatted: sessionsWithRecognition > 0
          ? `${totalLosses} pérdidas (${(totalLosses / sessionsWithRecognition).toFixed(2)} / episodio)`
          : 'No calculable (N/C)',
      },
      tasaErrorDeSesion: formatRate(sessionsWithError, totalSessionsInitiated),
    },
  }
}

module.exports = { PaseoAranjuezCoreService, computeMetricsFromEvents, parseDate }
