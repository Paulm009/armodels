/**
 * Servidor HTTP/REST Express para el Sistema WebAR de Paseo Aranjuez
 * Consultas públicas, administración con RBAC y telemetría sendBeacon (Sección 2.6.2).
 */
require('dotenv').config()
const path = require('path')
const fs = require('fs')
const express = require('express')
const { PaseoAranjuezCoreService } = require('./core-service')
const { configureSecurity } = require('./security')

const ROOT = path.resolve(__dirname, '..', '..')
const CLIENT_DIST = path.join(ROOT, 'client', 'dist')
const TARGETS_DIR = path.join(ROOT, 'image-targets')
const MEDIA_DIR = path.join(ROOT, 'public', 'media')

function getUserRole(req) {
  return req.adminRole || 'VISITANTE_PUBLICO'
}

function createServer(service = new PaseoAranjuezCoreService(), options = {}) {
  const app = express()
  const { production, sendError } = configureSecurity(app, options)
  app.use(express.json({ limit: '1mb', inflate: false }))

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
      const result = await service.getActiveCampaignForVisitor(req.params.campaignId, production ? undefined : req.query.date)
      if (!result.found) return res.status(404).json(result)
      return res.status(200).json(result)
    } catch (err) {
      return sendError(res, err, 500)
    }
  })

  // ============ EVENTOS / TELEMETRÍA ============
  app.post('/api/v1/events', async (req, res) => {
    try {
      const outcome = await service.ingestEvent(req.body)
      return res.status(outcome.deduplicated ? 200 : 201).json(outcome)
    } catch (err) {
      return sendError(res, err)
    }
  })

  // ============ ADMINISTRACIÓN (RBAC) ============
  app.get('/api/v1/admin/locales', async (req, res) => {
    try {
      const locales = await service.listLocales()
      return res.status(200).json(locales)
    } catch (err) {
      return sendError(res, err, 500)
    }
  })

  app.post('/api/v1/admin/locales', async (req, res) => {
    try {
      const local = await service.registerLocal(req.body, getUserRole(req))
      return res.status(201).json(local)
    } catch (err) {
      return sendError(res, err)
    }
  })

  app.put('/api/v1/admin/locales/:id', async (req, res) => {
    try {
      const local = await service.updateLocal(req.params.id, req.body, getUserRole(req))
      return res.status(200).json(local)
    } catch (err) {
      return sendError(res, err)
    }
  })

  app.get('/api/v1/admin/campaigns', async (req, res) => {
    try {
      const latestOnly = req.query.versions !== 'all'
      const campaigns = await service.listCampaigns({ latestOnly })
      return res.status(200).json(campaigns)
    } catch (err) {
      return sendError(res, err, 500)
    }
  })

  app.post('/api/v1/admin/campaigns', async (req, res) => {
    try {
      const saved = await service.saveCampaign(req.body, getUserRole(req), req.body.referenceDate)
      return res.status(201).json(saved)
    } catch (err) {
      return sendError(res, err)
    }
  })

  app.get('/api/v1/admin/campaigns/:campaignId/versions', async (req, res) => {
    try {
      const versions = await service.listCampaignVersions(req.params.campaignId)
      return res.status(200).json(versions)
    } catch (err) {
      return sendError(res, err, 500)
    }
  })

  app.get('/api/v1/admin/reports', async (req, res) => {
    try {
      const reports = await service.listReports()
      return res.status(200).json(reports)
    } catch (err) {
      return sendError(res, err, 500)
    }
  })

  app.get('/api/v1/admin/reports/:campaignId', async (req, res) => {
    try {
      const version = req.query.version ? Number(req.query.version) : null
      const report = await service.computeCampaignMetrics(req.params.campaignId, version)
      return res.status(200).json(report)
    } catch (err) {
      return sendError(res, err, 500)
    }
  })

  // ============ SPA FALLBACK ============
  const indexHtml = path.join(CLIENT_DIST, 'index.html')
  app.get(/^\/(?!api\/|image-targets\/|media\/).*/, (req, res) => {
    if (fs.existsSync(indexHtml)) return res.sendFile(indexHtml)
    return res.status(404).json({ error: 'Frontend no compilado. Ejecuta `npm run build`.' })
  })

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err)
    return sendError(res, err, 500)
  })

  return app
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000)
  const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0')
  const app = createServer()
  const socketActivated = process.env.LISTEN_FDS === '1' && Number(process.env.LISTEN_PID) === process.pid
  app.listen(socketActivated ? { fd: 3 } : { port, host }, () => {
    console.log(`[API] Sistema WebAR Paseo Aranjuez escuchando ${socketActivated ? 'en socket systemd' : `en http://${host}:${port}`}`)
  })
}

module.exports = { createServer }
