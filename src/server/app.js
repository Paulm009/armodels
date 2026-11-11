/**
 * Servidor HTTP/REST Express para el Sistema WebAR de Paseo Aranjuez
 * Consultas públicas, administración con RBAC y telemetría sendBeacon (Sección 2.6.2).
 */
require('dotenv').config()
const path = require('path')
const fs = require('fs')
const express = require('express')
const cors = require('cors')
const multer = require('multer')
const { PaseoAranjuezCoreService } = require('./core-service')

const ROOT = path.resolve(__dirname, '..', '..')
const CLIENT_DIST = path.join(ROOT, 'client', 'dist')
const TARGETS_DIR = path.join(ROOT, 'image-targets')
const MEDIA_DIR = path.join(ROOT, 'public', 'media')

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
})

function getUserRole(req) {
  return req.headers['x-admin-role'] || 'VISITANTE_PUBLICO'
}

function createServer(service = new PaseoAranjuezCoreService()) {
  const app = express()
  app.use(cors())
  app.use(express.json({ limit: '1mb' }))

  // ============ ESTÁTICOS ============
  app.use('/image-targets', express.static(TARGETS_DIR))
  app.use('/media', express.static(MEDIA_DIR))
  if (fs.existsSync(CLIENT_DIST)) {
    app.use(express.static(CLIENT_DIST))
  }

  // ============ SALUD ============
  app.get('/api/v1/health', (req, res) => res.status(200).json({ ok: true, service: 'paseo-aranjuez-webar' }))

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

  // ============ EVENTOS / TELEMETRÍA ============
  app.post('/api/v1/events', async (req, res) => {
    try {
      const outcome = await service.ingestEvent(req.body)
      return res.status(outcome.deduplicated ? 200 : 201).json(outcome)
    } catch (err) {
      return res.status(400).json({ error: err.message })
    }
  })

  // ============ ADMINISTRACIÓN (RBAC) ============
  app.get('/api/v1/admin/locales', async (req, res) => {
    try {
      const locales = await service.listLocales()
      return res.status(200).json(locales)
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/v1/admin/locales', async (req, res) => {
    try {
      const local = await service.registerLocal(req.body, getUserRole(req))
      return res.status(201).json(local)
    } catch (err) {
      return res.status(err.statusCode || 400).json({ error: err.message })
    }
  })

  app.put('/api/v1/admin/locales/:id', async (req, res) => {
    try {
      const local = await service.updateLocal(req.params.id, req.body, getUserRole(req))
      return res.status(200).json(local)
    } catch (err) {
      return res.status(err.statusCode || 400).json({ error: err.message })
    }
  })

  app.get('/api/v1/admin/campaigns', async (req, res) => {
    try {
      const latestOnly = req.query.versions !== 'all'
      const campaigns = await service.listCampaigns({ latestOnly })
      return res.status(200).json(campaigns)
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/v1/admin/campaigns', async (req, res) => {
    try {
      const saved = await service.saveCampaign(req.body, getUserRole(req), req.body.referenceDate)
      return res.status(201).json(saved)
    } catch (err) {
      return res.status(err.statusCode || 400).json({ error: err.message })
    }
  })

  app.get('/api/v1/admin/campaigns/:campaignId/versions', async (req, res) => {
    try {
      const versions = await service.listCampaignVersions(req.params.campaignId)
      return res.status(200).json(versions)
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  })

  // ============ IMAGE TARGETS Y MEDIOS AR ============
  app.get('/api/v1/admin/image-targets', async (req, res) => {
    try {
      const targets = await service.listImageTargets()
      return res.status(200).json(targets)
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/v1/admin/image-targets', upload.single('file'), async (req, res) => {
    try {
      service.authorizeAdminOperation(getUserRole(req), 'createImageTarget')
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

  app.post('/api/v1/admin/media', upload.single('file'), async (req, res) => {
    try {
      service.authorizeAdminOperation(getUserRole(req), 'storeMedia')
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

  app.get('/api/v1/admin/reports', async (req, res) => {
    try {
      const reports = await service.listReports()
      return res.status(200).json(reports)
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/v1/admin/reports/:campaignId', async (req, res) => {
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

  return app
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000)
  const app = createServer()
  app.listen(port, '0.0.0.0', () => {
    console.log(`[API] Sistema WebAR Paseo Aranjuez escuchando en http://localhost:${port}`)
    console.log(`[API] Acceso desde tu celular (misma red Wi-Fi): http://<IP-DE-ESTA-PC>:${port}`)
  })
}

module.exports = { createServer }
