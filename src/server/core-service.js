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
const { verifyPassword } = require('./auth')

const ALLOWED_ROLES_FOR_MUTATION = new Set(['DIRECCION_MARKETING', 'GERENCIA'])
const EVENT_TYPES = new Set([
  'SESSION_OPEN',
  'CAMERA_READY',
  'SCANNING_STARTED',
  'TARGET_FOUND',
  'TARGET_RECOVERED',
  'TARGET_LOST',
  'CONTENT_VIEWED',
  'CTA_CLICK',
  'TRACKING_INTERVAL_CLOSED',
  'SESSION_ERROR',
  'SESSION_CLOSE',
])
const ALLOWED_MIME_SIGNATURES = {
  'image/png': { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47] },
  'image/jpeg': { offset: 0, bytes: [0xff, 0xd8, 0xff] },
  'video/mp4': { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }, // 'ftyp'
}

const CAMPAIGN_STATES = ['EN_PREPARACION', 'PUBLICADA', 'ARCHIVADA', 'VENCIDA']
const TARGETS_DIR = path.resolve(__dirname, '..', '..', 'image-targets')
const MEDIA_DIR = path.resolve(__dirname, '..', '..', 'public', 'media')

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

const ROOT = path.resolve(__dirname, '..', '..')

function safeTargetName(value) {
  return path.basename(String(value || '').replace(/\\/g, '/'))
}

function normalizeTargetAsset(value, fallbackFile) {
  if (!value) return fallbackFile ? `/image-targets/${fallbackFile}` : ''
  const raw = String(value).replace(/\\/g, '/')
  if (/^https?:/i.test(raw)) return raw
  const clean = raw.replace(/^\/+/, '')
  if (clean.startsWith('image-targets/')) return `/${clean}`
  if (clean.includes('/')) return `/${clean}`
  return `/image-targets/${clean}`
}

function localPathFromUrl(value) {
  if (!value || typeof value !== 'string') return null
  if (/^https?:/i.test(value)) return null
  let clean = value.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!clean) return null
  // Las URLs públicas /media/... viven físicamente en public/media/...
  if (clean.startsWith('media/')) clean = `public/${clean}`
  return path.join(ROOT, clean)
}

function assertTargetAssets(target) {
  const name = safeTargetName(target.nombre_tecnico || target.name || '')
  const imagePath = target.image_path || target.imagePath || ''
  const metadataPath = name ? path.join(TARGETS_DIR, `${name}.json`) : null
  const hasMetadata = metadataPath && fs.existsSync(metadataPath)

  if (hasMetadata) {
    const expectedImage = localPathFromUrl(imagePath) || path.join(TARGETS_DIR, `${name}_luminance.png`)
    if (expectedImage && !fs.existsSync(expectedImage)) {
      throw new Error(`La imagen del objetivo '${name}' no existe en el servidor. Vuelve a generarla antes de publicar.`)
    }
    return
  }

  if (/image-targets\//i.test(imagePath)) {
    const expectedImage = localPathFromUrl(imagePath)
    if (expectedImage && !fs.existsSync(expectedImage)) {
      throw new Error(`La imagen objetivo '${imagePath}' no existe en el servidor.`)
    }
  }
}

function assertMediaAsset(mediaUrl) {
  if (!mediaUrl || !String(mediaUrl).startsWith('/media/')) return
  const filePath = localPathFromUrl(mediaUrl)
  if (filePath && !fs.existsSync(filePath)) {
    throw new Error(`El contenido '${mediaUrl}' no existe en el servidor. Súbelo de nuevo antes de publicar.`)
  }
}

/**
 * Verificación heurística de MP4 para móviles. 8th Wall/WebGL necesita que el
 * navegador pueda decodificar el video; H.264 en un MP4 con índice `moov` es la
 * combinación más compatible con iOS y Android.
 */
function validateMp4ForMobile(buffer) {
  if (!buffer || buffer.length < 12) throw new Error('El archivo MP4 está vacío o incompleto.')
  const hasFtyp = buffer.includes(Buffer.from('ftyp'))
  const hasMoov = buffer.includes(Buffer.from('moov'))
  const hasAvc = buffer.includes(Buffer.from('avc1')) || buffer.includes(Buffer.from('avc3'))
  if (!hasFtyp || !hasMoov) {
    throw new Error('El MP4 no tiene una estructura válida (falta ftyp o moov). Vuelve a exportarlo.')
  }
  if (!hasAvc) {
    throw new Error(
      'El video debe usar H.264 (AVC) para reproducirse en iPhone y Android. Exporta el MP4 con códec H.264, formato yuv420p y faststart.'
    )
  }
}

async function computeContrastScore(filePath) {
  try {
    const sharp = await import('sharp').then((m) => m.default)
    const stats = await sharp(filePath).greyscale().stats()
    const stdev = stats.channels && stats.channels[0] ? stats.channels[0].stdev : 0
    return Math.max(0, Math.min(100, Math.round(stdev * 1.6)))
  } catch {
    return null
  }
}

function publicCampaignUrl(campaignId) {
  const base = String(process.env.PUBLIC_BASE_URL || process.env.VITE_PUBLIC_URL || '').replace(/\/+$/, '')
  return `${base}/ar/${encodeURIComponent(campaignId)}`
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
   * Autenticación de usuarios administrativos (OE2 / Sección 2.10.1).
   * Devuelve los datos públicos del usuario o null.
   */
  async authenticateAdmin(usuario, password) {
    if (!usuario || !password) return null
    const user = await this.prisma.usuarioAdministrativo.findUnique({ where: { usuario } })
    if (!user || !user.activo || !user.passwordHash) return null
    if (!verifyPassword(password, user.passwordHash)) return null
    return {
      id: user.id,
      usuario: user.usuario,
      nombre: user.nombre,
      cargo: user.cargo,
      rol: user.rol,
    }
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
    const spec = ALLOWED_MIME_SIGNATURES[mimeType]
    if (Array.isArray(magicBytes) && magicBytes.length >= spec.offset + spec.bytes.length) {
      const matches = spec.bytes.every((byte, idx) => magicBytes[spec.offset + idx] === byte)
      if (!matches) {
        throw new Error(`La firma binaria del archivo '${filename}' no coincide con el tipo declarado (${mimeType}).`)
      }
    }
    if (mimeType.startsWith('image/')) {
      const minSide = Math.min(Number(width) || 0, Number(height) || 0)
      const maxSide = Math.max(Number(width) || 0, Number(height) || 0)
      if (minSide < 480 || maxSide < 640) {
        throw new Error(
          `Resolución insuficiente (${width}x${height}). El objetivo debe tener al menos 480 px en el lado menor y 640 px en el mayor.`
        )
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
    const targetName = t.nombre_tecnico || t.name || `${campaign_id}-target`

    if (estado === 'PUBLICADA') {
      assertTargetAssets({ ...t, nombre_tecnico: targetName })
      assertMediaAsset(c.media_url || c.mediaUrl)
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
        nombreTecnico: targetName,
        imagePath: normalizeTargetAsset(t.image_path || t.imagePath, `${targetName}_luminance.png`),
        thumbnailPath: normalizeTargetAsset(t.thumbnail_path || t.thumbnailPath, `${targetName}_thumbnail.png`),
        originalPath: normalizeTargetAsset(t.original_path || t.originalPath, `${targetName}_original.png`),
        propertiesJson: JSON.stringify(t.properties || {}),
        contrastScore: t.contrast_score ?? t.contrastScore ?? 80,
        qrAccessUrl: t.qr_access_url || t.qrAccessUrl || publicCampaignUrl(campaign_id),
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

  /* ==================== IMAGE TARGETS Y MEDIOS AR ==================== */

  /**
   * Lista los image targets 8th Wall disponibles en image-targets/.
   * Cada entrada expone name, type, properties y las rutas de sus recursos
   * para que el panel pueda mostrar una vista previa y permitir su selección.
   */
  async listImageTargets() {
    let files = []
    try {
      files = fs.readdirSync(TARGETS_DIR)
    } catch {
      return []
    }
    const targets = []
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const name = file.replace(/\.json$/, '')
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(TARGETS_DIR, file), 'utf-8'))
        const resources = raw.resources || {}
        const luminanceFile = resources.luminanceImage || `${name}_luminance.png`
        const imagePath = normalizeTargetAsset(raw.imagePath, luminanceFile)
        const fullImagePath = localPathFromUrl(imagePath)
        const contrastScore = fullImagePath ? await computeContrastScore(fullImagePath) : null
        targets.push({
          name: raw.name || name,
          type: raw.type || 'PLANAR',
          properties: raw.properties || {},
          imagePath,
          thumbnail: normalizeTargetAsset(null, resources.thumbnailImage || `${name}_thumbnail.png`),
          originalPath: normalizeTargetAsset(null, resources.originalImage || `${name}_original.png`),
          resources,
          contrastScore,
          contrast_score: contrastScore,
        })
      } catch {
        /* archivo de metadata corrupto, se omite */
      }
    }
    return targets.sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * Genera un nuevo image target 8th Wall a partir de una imagen subida.
   * Utiliza el CLI oficial (@8thwall/image-target-cli) para producir el JSON
   * de metadata y los recursos (luminancia, miniatura, recorte y original).
   */
  async createImageTarget({ buffer, mimeType, sizeBytes, originalName }) {
    const safeBase = this.sanitizeFilename(originalName || 'afiche').replace(/\.[^.]+$/, '') || 'afiche'
    const name = `target_${Date.now()}_${safeBase}`
    const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/png' ? 'png' : null
    if (!extension) {
      throw new Error(`Formato de afiche no soportado (${mimeType}). Usa PNG o JPG.`)
    }

    const sharp = await import('sharp').then((m) => m.default)
    const image = sharp(buffer)
    const meta = await image.metadata()
    const magicBytes = Array.from(buffer.subarray(0, 16))

    this.validateUploadedAsset({
      filename: `${name}.${extension}`,
      mimeType,
      sizeBytes,
      magicBytes,
      width: meta.width,
      height: meta.height,
    })

    const { applyCrop } = await import('@8thwall/image-target-cli/src/apply.js')
    const { getDefaultCrop } = await import('@8thwall/image-target-cli/src/crop.js')

    const sourceIsLandscape = meta.width >= meta.height
    const crop = { type: 'PLANAR', geometry: getDefaultCrop(meta, sourceIsLandscape) }
    await applyCrop(image, crop, TARGETS_DIR, name, true)

    const dataPath = path.join(TARGETS_DIR, `${name}.json`)
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'))
    const resources = data.resources || {}
    const luminanceFile = resources.luminanceImage || `${name}_luminance.png`
    const contrastScore = await computeContrastScore(path.join(TARGETS_DIR, luminanceFile))
    return {
      name: data.name || name,
      type: data.type || 'PLANAR',
      properties: data.properties || {},
      imagePath: normalizeTargetAsset(data.imagePath, luminanceFile),
      originalPath: normalizeTargetAsset(null, resources.originalImage || `${name}_original.png`),
      resources,
      thumbnail: normalizeTargetAsset(null, resources.thumbnailImage || `${name}_thumbnail.png`),
      contrastScore,
      contrast_score: contrastScore,
    }
  }

  /**
   * Almacena un medio AR (imagen o video MP4) en public/media/ y devuelve la
   * URL pública para referenciarlo desde el contenido de la campaña.
   */
  async storeMedia({ buffer, mimeType, sizeBytes, originalName }) {
    const extension = mimeType === 'image/png' ? 'png'
      : mimeType === 'image/jpeg' ? 'jpg'
      : mimeType === 'video/mp4' ? 'mp4'
      : null
    if (!extension) {
      throw new Error(`Formato de contenido no soportado (${mimeType}). Usa PNG, JPG o MP4.`)
    }

    const filename = `${Date.now()}_${this.sanitizeFilename(originalName || `contenido.${extension}`)}`
    const magicBytes = Array.from(buffer.subarray(0, 16))

    if (mimeType === 'video/mp4') validateMp4ForMobile(buffer)

    const extra = {}
    if (mimeType.startsWith('image/')) {
      const sharp = await import('sharp').then((m) => m.default)
      const meta = await sharp(buffer).metadata()
      extra.width = meta.width
      extra.height = meta.height
    }

    this.validateUploadedAsset({
      filename,
      mimeType,
      sizeBytes,
      magicBytes,
      width: extra.width,
      height: extra.height,
    })

    await fs.promises.mkdir(MEDIA_DIR, { recursive: true })
    await fs.promises.writeFile(path.join(MEDIA_DIR, filename), buffer)

    return {
      url: `/media/${filename}`,
      filename,
      mimeType,
      sizeBytes,
    }
  }

  sanitizeFilename(value) {
    const safe = String(value || '').replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase()
    return safe.replace(/^_+|_+$/g, '') || 'archivo'
  }

  async getActiveCampaignForVisitor(campaignId, referenceDateStr = null) {
    const versions = await this.listCampaignVersions(campaignId)
    if (!versions.length) {
      return { found: false, status: 'NOT_FOUND', message: 'Campaña no registrada.' }
    }
    const latest = versions[0]
    const referenceDate = referenceDateStr ? parseDate(referenceDateStr) : new Date()
    const fechaInicio = parseDate(latest.fecha_inicio)
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
    if (fechaInicio && fechaInicio > referenceDate) {
      return {
        found: true,
        status: 'NOT_STARTED',
        campaign: latest,
        showPromotionalMedia: false,
        message: 'La campaña todavía no ha comenzado. Consulta nuevamente en su fecha de inicio.',
      }
    }

    const imageTargetData = latest.targets.map((target) => {
      const metadata = this.readTargetMetadata(target)
      const content = latest.contents.find((item) => item.imagen_objetivo_id === target.id) || latest.content
      return {
        ...metadata,
        targetId: target.target_id,
        targetDbId: target.id,
        targetVersion: target.target_version,
        content,
      }
    })
    return {
      found: true,
      status: 'ACTIVE',
      campaign: latest,
      showPromotionalMedia: true,
      publicUrl: publicCampaignUrl(campaignId),
      qrUrl: `/api/v1/public/campaigns/${encodeURIComponent(campaignId)}/qr`,
      imageTargetData,
    }
  }

  readTargetMetadata(target) {
    const name = safeTargetName(target.nombre_tecnico || target.target_id)
    const filePath = path.join(TARGETS_DIR, `${name}.json`)
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      const resources = raw.resources || {}
      return {
        ...raw,
        name: raw.name || name,
        imagePath: normalizeTargetAsset(raw.imagePath, resources.luminanceImage || `${name}_luminance.png`),
        thumbnail: normalizeTargetAsset(null, resources.thumbnailImage || `${name}_thumbnail.png`),
        originalPath: normalizeTargetAsset(null, resources.originalImage || `${name}_original.png`),
        resources,
      }
    } catch {
      // Reconstrucción mínima a partir del registro persistido
      return {
        imagePath: normalizeTargetAsset(target.image_path, `${name}_luminance.png`),
        thumbnail: normalizeTargetAsset(target.thumbnail_path, `${name}_thumbnail.png`),
        originalPath: normalizeTargetAsset(target.original_path, `${name}_original.png`),
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
    if (!eventInput || typeof eventInput !== 'object') {
      throw new Error('Contrato de evento inválido: se esperaba un objeto JSON.')
    }
    const requiredFields = ['event_id', 'session_id', 'campaign_id', 'campaign_version', 'event_type', 'client_time']
    for (const field of requiredFields) {
      if (eventInput[field] === undefined || eventInput[field] === null || eventInput[field] === '') {
        throw new Error(`Contrato de evento inválido: falta el campo obligatorio '${field}'.`)
      }
    }
    if (!EVENT_TYPES.has(eventInput.event_type)) {
      throw new Error(`Tipo de evento no permitido: '${eventInput.event_type}'.`)
    }
    if (eventInput.payload && typeof eventInput.payload === 'object') {
      const payloadSize = Buffer.byteLength(JSON.stringify(eventInput.payload), 'utf8')
      if (payloadSize > 16 * 1024) {
        throw new Error('El payload del evento supera el límite de 16 KB.')
      }
    }

    const existing = await this.prisma.evento.findUnique({ where: { eventId: eventInput.event_id } })
    if (existing) {
      return { deduplicated: true, event: serializeEvent(existing) }
    }

    const campaignVersion = await this.prisma.campana.findFirst({
      where: { campaignId: eventInput.campaign_id, version: Number(eventInput.campaign_version) },
      select: { id: true },
    })
    if (!campaignVersion) {
      const err = new Error(`La campaña '${eventInput.campaign_id}' en la versión ${eventInput.campaign_version} no está registrada.`)
      err.statusCode = 404
      throw err
    }

    const eventType = eventInput.event_type
    const deviceFamily = eventInput.device_family || (eventInput.payload && eventInput.payload.deviceFamily) || 'unknown'
    const userAgent = eventInput.user_agent || null
    const engineVersion = eventInput.engine_version || null
    const appVersion = eventInput.app_version || null
    const errorCategory =
      eventType === 'SESSION_ERROR' ? (eventInput.payload && eventInput.payload.errorCategory) || 'UNKNOWN' : null

    const sessionUpdate = {}
    if (eventType === 'CAMERA_READY') sessionUpdate.cameraReady = true
    if (eventType === 'SCANNING_STARTED') sessionUpdate.scanningStarted = true
    if (eventType === 'SESSION_CLOSE') sessionUpdate.endedAt = new Date()
    if (userAgent) sessionUpdate.userAgent = userAgent
    if (engineVersion) sessionUpdate.engineVersion = engineVersion
    if (appVersion) sessionUpdate.appVersion = appVersion

    await this.prisma.sesion.upsert({
      where: { sessionId: eventInput.session_id },
      update: sessionUpdate,
      create: {
        sessionId: eventInput.session_id,
        campaignId: eventInput.campaign_id,
        campaignVersion: Number(eventInput.campaign_version),
        accessMechanism: (eventInput.payload && eventInput.payload.accessMechanism) || 'DIRECT_URL',
        deviceFamily,
        userAgent,
        engineVersion,
        appVersion,
        cameraReady: eventType === 'CAMERA_READY',
        scanningStarted: eventType === 'SCANNING_STARTED',
        startedAt: parseDate(eventInput.client_time) || new Date(),
      },
    })

    try {
      const stored = await this.prisma.evento.create({
        data: {
          eventId: eventInput.event_id,
          sessionId: eventInput.session_id,
          campaignId: eventInput.campaign_id,
          campaignVersion: Number(eventInput.campaign_version),
          targetId: eventInput.target_id || null,
          targetVersion: eventInput.target_version ? Number(eventInput.target_version) : null,
          eventType,
          payload: JSON.stringify(eventInput.payload || {}),
          deviceFamily,
          userAgent,
          engineVersion,
          appVersion,
          errorCategory,
          clientTime: parseDate(eventInput.client_time) || new Date(),
          schemaVersion: eventInput.schema_version || '1.1.0',
        },
      })
      return { deduplicated: false, event: serializeEvent(stored) }
    } catch (error) {
      // Dos reintentos simultáneos pueden chocar con la clave única de event_id.
      if (error && error.code === 'P2002') {
        const duplicated = await this.prisma.evento.findUnique({ where: { eventId: eventInput.event_id } })
        if (duplicated) return { deduplicated: true, event: serializeEvent(duplicated) }
      }
      throw error
    }
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

  async listReports({ latestOnly = true } = {}) {
    const campanas = await this.prisma.campana.findMany({
      orderBy: [{ campaignId: 'asc' }, { version: 'desc' }],
      include: { local: true },
    })
    const seen = new Set()
    const selected = latestOnly
      ? campanas.filter((campaign) => {
          if (seen.has(campaign.campaignId)) return false
          seen.add(campaign.campaignId)
          return true
        })
      : campanas

    const reports = []
    for (const c of selected) {
      const metrics = await this.computeCampaignMetrics(c.campaignId, c.version)
      reports.push({
        campaignId: c.campaignId,
        title: c.nombre,
        version: c.version,
        estado: c.estado,
        local: c.local ? { id: c.local.id, nombre: c.local.nombre } : null,
        fechaInicio: toISODate(c.fechaInicio),
        fechaFin: toISODate(c.fechaFin),
        mode: 'CAMERA',
        sessions: metrics.indicators.sesionesConReconocimiento.denominator,
        recognized: metrics.indicators.sesionesConReconocimiento.value,
        trackingSec: metrics.indicators.seguimientoVisibleSegundos.valueSec,
        ctaClicks: metrics.indicators.sesionesConCTA.numerator,
        errors: metrics.indicators.tasaErrorDeSesion.numerator,
        uniqueEventsCount: metrics.uniqueEventsCount,
        metrics: metrics.indicators,
      })
    }
    return reports
  }

  async updateCampaignStatus(campaignId, estado, userRole = 'DIRECCION_MARKETING') {
    this.authorizeAdminOperation(userRole, 'updateCampaignStatus')
    if (!CAMPAIGN_STATES.includes(estado)) throw new Error(`Estado de campaña inválido: ${estado}.`)

    const latest = await this.prisma.campana.findFirst({
      where: { campaignId },
      orderBy: { version: 'desc' },
      include: { imagenes: true, contenidos: true },
    })
    if (!latest) {
      const err = new Error(`La campaña '${campaignId}' no existe.`)
      err.statusCode = 404
      throw err
    }

    if (estado === 'PUBLICADA') {
      if (latest.fechaFin < new Date()) {
        throw new Error('No se puede publicar una campaña cuya fecha de vigencia ya ha vencido (Sección 2.11.1).')
      }
      if (!latest.imagenes.length) {
        throw new Error('No se puede publicar una campaña sin su Imagen Objetivo.')
      }
      if (!latest.contenidos.length) {
        throw new Error('No se puede publicar una campaña sin contenido.')
      }
      const target = latest.imagenes[0]
      assertTargetAssets({
        nombre_tecnico: target.nombreTecnico,
        image_path: target.imagePath,
      })
      assertMediaAsset(latest.contenidos[0].mediaUrl)
    }

    await this.prisma.campana.update({ where: { id: latest.id }, data: { estado } })
    return this.getCampaignById(campaignId, latest.version)
  }

  async updateCampaignContent(campaignId, content = {}, userRole = 'DIRECCION_MARKETING') {
    this.authorizeAdminOperation(userRole, 'updateCampaignContent')
    const latest = await this.prisma.campana.findFirst({
      where: { campaignId },
      orderBy: { version: 'desc' },
      include: { contenidos: true },
    })
    if (!latest) {
      const err = new Error(`La campaña '${campaignId}' no existe.`)
      err.statusCode = 404
      throw err
    }
    const current = latest.contenidos[0]
    if (!current) {
      throw new Error('La campaña no tiene un contenido registrado que actualizar.')
    }
    const mediaUrl = content.media_url || content.mediaUrl || current.mediaUrl
    assertMediaAsset(mediaUrl)
    await this.prisma.contenido.update({
      where: { id: current.id },
      data: {
        mediaUrl,
        mediaMimeType: content.media_mime_type || content.mediaMimeType || current.mediaMimeType,
        mediaSizeBytes: content.media_size_bytes || content.mediaSizeBytes || current.mediaSizeBytes,
        tituloPromocion: content.titulo_promocion || content.tituloPromocion || current.tituloPromocion,
        condicionesTexto: content.condiciones_texto || content.condicionesTexto || current.condicionesTexto,
        ctaPrimariaLabel: content.cta_primaria_label || content.ctaPrimariaLabel || current.ctaPrimariaLabel,
        ctaSecundariaLabel: content.cta_secundaria_label || content.ctaSecundariaLabel || current.ctaSecundariaLabel,
        ctaSecundariaUrl: content.cta_secundaria_url || content.ctaSecundariaUrl || current.ctaSecundariaUrl,
      },
    })
    return this.getCampaignById(campaignId, latest.version)
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
    device_family: e.deviceFamily || null,
    user_agent: e.userAgent || null,
    engine_version: e.engineVersion || null,
    app_version: e.appVersion || null,
    error_category: e.errorCategory || null,
    client_time: e.clientTime ? e.clientTime.toISOString() : null,
    received_at: e.receivedAt ? e.receivedAt.toISOString() : null,
    schema_version: e.schemaVersion,
  }
}

function serializeCampaign(c) {
  const targets = (c.imagenes || []).map((t) => ({
    id: t.id,
    target_id: t.targetId,
    target_version: t.version,
    nombre_tecnico: t.nombreTecnico,
    image_path: normalizeTargetAsset(t.imagePath, `${t.nombreTecnico}_luminance.png`),
    thumbnail_path: normalizeTargetAsset(t.thumbnailPath, `${t.nombreTecnico}_thumbnail.png`),
    original_path: normalizeTargetAsset(t.originalPath, `${t.nombreTecnico}_original.png`),
    properties: safeParseJson(t.propertiesJson, {}),
    contrast_score: t.contrastScore,
    qr_access_url: t.qrAccessUrl,
  }))
  const contents = (c.contenidos || []).map((ct) => ({
    content_id: ct.id,
    imagen_objetivo_id: ct.imagenObjetivoId,
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
