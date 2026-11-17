/**
 * Servidor HTTP/REST Express para el Sistema WebAR de Paseo Aranjuez.
 * Consultas públicas, administración con RBAC, telemetría y QR.
 */
require('dotenv').config()
const path = require('path')
const fs = require('fs')
const express = require('express')
const cors = require('cors')
const multer = require('multer')
const QRCode = require('qrcode')
const { PaseoAranjuezCoreService } = require('./core-service')
const { signToken, requireAuth } = require('./auth')

const ROOT = path.resolve(__dirname, '..', '..')
const CLIENT_DIST = path.join(ROOT, 'client', 'dist')
const TARGETS_DIR = path.join(ROOT, 'image-targets')
const MEDIA_DIR = path.join(ROOT, 'public', 'media')

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
})

function createRateLimiter({ windowMs, max }) {
  const hits = new Map()
  return (req, res, next) => {
    const now = Date.now()
    const key = req.ip || req.socket.remoteAddress || 'unknown'
    const entry = hits.get(key)
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs })
      return next()
    }
    entry.count += 1
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000))
      return res.status(429).json({ error: 'Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.' })
    }
    return next()
  }
}

function corsOptions() {
  const configured = String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  if (configured.length === 0) return { origin: true, credentials: true }
  return { origin: configured, credentials: true }
}

function createServer(service = new PaseoAranjuezCoreService()) {
  const app = express()
  app.use(cors(corsOptions()))
  app.use(express.json({ limit: '1mb' }))
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'SAMEORIGIN')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=()')
    next()
  })

  const eventsLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 180 })
  const loginLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 12 })

  // ============ ESTÁTICOS ============
  app.use('/image-targets', express.static(TARGETS_DIR))
  app.use('/media', express.static(MEDIA_DIR))
  if (fs.existsSync(CLIENT_DIST)) {
    app.use(express.static(CLIENT_DIST))
  }

  // ============ SALUD ============
  app.get('/api/v1/health', (req, res) => res.status(200).json({ ok: true, service: 'paseo-aranjuez-webar' }))

  // ============ AUTENTICACIÓN ============
  app.post('/api/v1/auth/login', loginLimiter, async (req, res) => {
    try {
      const { usuario, password } = req.body || {}
      const user = await service.authenticateAdmin(usuario, password)
      if (!user) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' })
      const token = signToken({
        sub: user.id,
        usuario: user.usuario,
        nombre: user.nombre,
        cargo: user.cargo,
        rol: user.rol,
      })
      res.setHeader(
        'Set-Cookie',
        `webar_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800` +
          (process.env.NODE_ENV === 'production' ? '; Secure' : '')
      )
      return res.status(200).json({ token, user })
    } catch (err) {
      return res.status(500).json({ error: 'No se pudo iniciar sesión.' })
    }
  })

  app.get('/api/v1/auth/me', requireAuth, (req, res) => res.status(200).json({ user: req.user }))

  app.post('/api/v1/auth/logout', (req, res) => {
    res.setHeader('Set-Cookie', 'webar_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0')
    return res.status(204).end()
  })

  // ============ PÚBLICO (VISITANTE) ============
  app.get('/api/v1/public/campaigns/:campaignId', async (req, res) => {
    try {
      const result = await service.getActiveCampaignForVisitor(req.params.campaignId, req.query.date)
      if (!result.found) return res.status(404).json(result)
      return res.status(200).json(result)
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/v1/public/campaigns/:campaignId/qr', async (req, res) => {
    try {
      const result = await service.getActiveCampaignForVisitor(req.params.campaignId)
      if (!result.found) return res.status(404).json({ error: 'Campaña no registrada.' })
      const base = String(process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '')
      const targetUrl = `${base}/ar/${encodeURIComponent(req.params.campaignId)}`
      const size = Math.min(1024, Math.max(128, Number(req.query.size) || 512))
      const buffer = await QRCode.toBuffer(targetUrl, {
        type: 'png',
        width: size,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: { dark: '#1b4332', light: '#ffffff' },
      })
      res.setHeader('Content-Type', 'image/png')
      res.setHeader('Cache-Control', 'public, max-age=3600')
      return res.send(buffer)
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  })

  // ============ EVENTOS / TELEMETRÍA ============
  app.post('/api/v1/events', eventsLimiter, async (req, res) => {
    try {
      const outcome = await service.ingestEvent(req.body)
      return res.status(outcome.deduplicated ? 200 : 201).json(outcome)
    } catch (err) {
      return res.status(err.statusCode || 400).json({ error: err.message })
    }
  })

  // ============ ADMINISTRACIÓN (RBAC) ============
  app.get('/api/v1/admin/locales', requireAuth, async (req, res) => {
    try {
      const locales = await service.listLocales()
      return res.status(200).json(locales)
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/v1/admin/locales', requireAuth, async (req, res) => {
    try {
      const local = await service.registerLocal(req.body, req.user.rol)
      return res.status(201).json(local)
    } catch (err) {
      return res.status(err.statusCode || 400).json({ error: err.message })
    }
  })

  app.put('/api/v1/admin/locales/:id', requireAuth, async (req, res) => {
    try {
      const local = await service.updateLocal(req.params.id, req.body, req.user.rol)
      return res.status(200).json(local)
    } catch (err) {
      return res.status(err.statusCode || 400).json({ error: err.message })
    }
  })

  app.get('/api/v1/admin/campaigns', requireAuth, async (req, res) => {
    try {
      const latestOnly = req.query.versions !== 'all'
      const campaigns = await service.listCampaigns({ latestOnly })
      return res.status(200).json(campaigns)
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/v1/admin/campaigns', requireAuth, async (req, res) => {
    try {
      const saved = await service.saveCampaign(req.body, req.user.rol, req.body.referenceDate)
      return res.status(201).json(saved)
    } catch (err) {
      return res.status(err.statusCode || 400).json({ error: err.message })
    }
  })

  app.patch('/api/v1/admin/campaigns/:campaignId/status', requireAuth, async (req, res) => {
    try {
      const updated = await service.updateCampaignStatus(req.params.campaignId, req.body.estado, req.user.rol)
      return res.status(200).json(updated)
    } catch (err) {
      return res.status(err.statusCode || 400).json({ error: err.message })
    }
  })

  app.put('/api/v1/admin/campaigns/:campaignId/content', requireAuth, async (req, res) => {
    try {
      const updated = await service.updateCampaignContent(req.params.campaignId, req.body, req.user.rol)
      return res.status(200).json(updated)
    } catch (err) {
      return res.status(err.statusCode || 400).json({ error: err.message })
    }
  })

  app.get('/api/v1/admin/campaigns/:campaignId/versions', requireAuth, async (req, res) => {
    try {
      const versions = await service.listCampaignVersions(req.params.campaignId)
      return res.status(200).json(versions)
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  })

  // ============ IMAGE TARGETS Y MEDIOS AR ============
  app.get('/api/v1/admin/image-targets', requireAuth, async (req, res) => {
    try {
      const targets = await service.listImageTargets()
      return res.status(200).json(targets)
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/v1/admin/image-targets', requireAuth, upload.single('file'), async (req, res) => {
    try {
      service.authorizeAdminOperation(req.user.rol, 'createImageTarget')
      if (!req.file) throw new Error('No se recibió ningún archivo de afiche.')
      const target = await service.createImageTarget({
        buffer: req.file.buffer,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        originalName: req.file.originalname,
      })
      return res.status(201).json(target)
    } catch (err) {
      return res.status(err.statusCode || 400).json({ error: err.message })
    }
  })

  app.post('/api/v1/admin/media', requireAuth, upload.single('file'), async (req, res) => {
    try {
      service.authorizeAdminOperation(req.user.rol, 'storeMedia')
      if (!req.file) throw new Error('No se recibió ningún archivo de contenido.')
      const media = await service.storeMedia({
        buffer: req.file.buffer,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        originalName: req.file.originalname,
      })
      return res.status(201).json(media)
    } catch (err) {
      return res.status(err.statusCode || 400).json({ error: err.message })
    }
  })

  // ============ REPORTES ============
  app.get('/api/v1/admin/reports', requireAuth, async (req, res) => {
    try {
      const allVersions = req.query.versions === 'all'
      const reports = await service.listReports({ latestOnly: !allVersions })
      return res.status(200).json(reports)
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/v1/admin/reports/:campaignId', requireAuth, async (req, res) => {
    try {
      const version = req.query.version ? Number(req.query.version) : null
      const report = await service.computeCampaignMetrics(req.params.campaignId, version)
      return res.status(200).json(report)
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  })

  // ============ SPA FALLBACK ============
  const indexHtml = path.join(CLIENT_DIST, 'index.html')
  app.get(/^\/(?!api\/|image-targets\/|media\/).*/, (req, res) => {
    if (fs.existsSync(indexHtml)) return res.sendFile(indexHtml)
    return res.status(404).json({ error: 'Frontend no compilado. Ejecuta `npm run build`.' })
  })

  // Manejo de errores no controlados (sin exponer trazas en producción).
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err)
    const isProd = process.env.NODE_ENV === 'production'
    return res.status(err.statusCode || 500).json({
      error: isProd ? 'Error interno del servidor.' : err.message || 'Error interno del servidor.',
    })
  })

  return app
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000)
  const app = createServer()
  app.listen(port, '0.0.0.0', () => {
    console.log(`[API] Sistema WebAR Paseo Aranjuez escuchando en http://localhost:${port}`)
    console.log(`[API] Acceso desde tu celular: usa HTTPS o un túnel. La cámara no funciona por HTTP.`)
  })
}

module.exports = { createServer }
