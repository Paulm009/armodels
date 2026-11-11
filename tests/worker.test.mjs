import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { after, before, test } from 'node:test'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { D1Repository } from '../src/server/d1-repository.js'
import { PaseoAranjuezCoreService, computeMetricsFromEvents } from '../src/server/core-service.js'

let runtime, db, repository, service
const testToken = 'isolated-test-admin-token'
const date = new Date().toISOString().slice(0, 10)

before(async () => {
  runtime = new Miniflare(convertV4MiniflareOptions({
    name: 'armodels-test',
    modules: true,
    scriptPath: fileURLToPath(new URL('../.test-worker/worker.js', import.meta.url)),
    compatibilityDate: '2026-11-11',
    d1Databases: ['DB'],
    bindings: { ADMIN_TOKEN: testToken },
    assets: {
      directory: fileURLToPath(new URL('../client/dist', import.meta.url)),
      binding: 'ASSETS', run_worker_first: ['/api', '/api/*'],
      routerConfig: { has_user_worker: true },
      assetConfig: { not_found_handling: 'none' },
    },
  }))
  db = await runtime.getD1Database('DB')
  for (const migration of ['0001_initial.sql', '0002_demo_data.sql']) {
    const sql = readFileSync(new URL(`../migrations/${migration}`, import.meta.url), 'utf8')
    await db.batch(sql.split(';').filter((part) => part.trim()).map((part) => db.prepare(part)))
  }
  repository = new D1Repository(db)
  service = new PaseoAranjuezCoreService(repository)
})

after(async () => { await runtime?.dispose() })

function request(path, { method = 'GET', body, admin = false, headers = {} } = {}) {
  return runtime.dispatchFetch(`https://armodels.test${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(admin ? { Authorization: `Bearer ${testToken}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function campaign(id) {
  return {
    campaign_id: id, local_id: 'demo-locales-1', nombre: id, estado: 'PUBLICADA',
    fecha_inicio: date, fecha_fin: '2099-12-31',
    target: { target_id: 'shared-poster', nombre_tecnico: 'cafe_altura', image_path: '/image-targets/cafe_altura_luminance.png' },
    content: { media_url: '/media/promo_cafe_altura.png', condiciones_texto: 'Condiciones de prueba.' },
  }
}

function event(id, overrides = {}) {
  return {
    event_id: id, session_id: 'concurrent-session', campaign_id: 'camp-cafe-altura',
    campaign_version: 1, event_type: 'SESSION_OPEN', client_time: `${date}T12:00:00Z`, ...overrides,
  }
}

test('health comprueba D1; rutas API desconocidas y métodos conservan respuestas JSON', async () => {
  const health = await request('/api/v1/health')
  assert.equal(health.status, 200)
  assert.equal((await health.json()).database, 'd1')
  for (const path of ['/api', '/api/v1/missing']) {
    const response = await request(path, { headers: { Accept: 'text/html' } })
    assert.equal(response.status, 404)
    assert.match(response.headers.get('content-type'), /application\/json/)
  }
  assert.equal((await request('/api/v1/events')).status, 405)
})

test('sirve SPA, imágenes y metadata real; archivos ausentes no devuelven HTML de la SPA', async () => {
  const home = await request('/')
  assert.match(await home.text(), /Laboratorio WebAR/)
  const deep = await request('/campaigns', { headers: { Accept: 'text/html' } })
  assert.equal(deep.status, 200)
  assert.match(await deep.text(), /Laboratorio WebAR/)
  for (const path of ['/image-targets/cafe_altura_luminance.png', '/media/promo_cafe_altura.png']) {
    const asset = await request(path)
    assert.equal(asset.status, 200)
    assert.match(asset.headers.get('content-type'), /image\/png/)
  }
  const missing = await request('/image-targets/missing.json', { headers: { Accept: 'text/html' } })
  assert.equal(missing.status, 404)
  const lookup = await request('/api/v1/public/campaigns/camp-cafe-altura')
  const result = await lookup.json()
  // La fecha de las campañas demo es fija; el contenido AR debe mantenerse
  // completo siempre que la promoción siga vigente.
  if (result.status === 'ACTIVE') {
    assert.equal(result.imageTargetData[0].properties.width, 1280)
    assert.equal(result.imageTargetData[0].resources.croppedImage, 'cafe_altura_cropped.png')
  }
})

test('una cabecera de rol falsificada no permite escribir; la clave válida sí', async () => {
  const body = { nombre: 'Local autenticado', rubro: 'Pruebas' }
  assert.equal((await request('/api/v1/admin/locales', { method: 'POST', body, headers: { 'x-admin-role': 'GERENCIA' } })).status, 401)
  assert.equal((await request('/api/v1/admin/locales', { method: 'POST', body, headers: { Authorization: 'Bearer wrong' } })).status, 401)
  const created = await request('/api/v1/admin/locales', { method: 'POST', body, admin: true })
  assert.equal(created.status, 201)
  const local = await created.json()
  assert.equal(local.activo, true)
  assert.equal(local.ubicacion, 'Planta baja')
  const updated = await request(`/api/v1/admin/locales/${local.id}`, { method: 'PUT', body: { ubicacion: 'Nivel 2' }, admin: true })
  assert.equal(updated.status, 200)
  assert.equal((await updated.json()).ubicacion, 'Nivel 2')
  assert.equal((await request('/api/v1/admin/locales', { method: 'POST', body, admin: true })).status, 409)
})

test('valida JSON, tamaño, campos obligatorios y versiones antes de escribir', async () => {
  assert.equal((await request('/api/v1/events', { method: 'POST', body: null })).status, 400)
  assert.equal((await request('/api/v1/events', { method: 'POST', body: {} })).status, 400)
  assert.equal((await request('/api/v1/events', { method: 'POST', body: event('bad-version', { campaign_version: '1' }) })).status, 400)
  assert.equal((await request('/api/v1/events', { method: 'POST', body: event('bad-date', { client_time: 'invalid' }) })).status, 400)
  assert.equal((await request('/api/v1/events', { method: 'POST', body: event('bad-payload', { payload: [] }) })).status, 400)
  assert.equal((await request('/api/v1/events', { method: 'POST', body: {}, headers: { 'Content-Type': 'text/plain' } })).status, 415)
  assert.equal((await request('/api/v1/events', { method: 'POST', body: { data: 'x'.repeat(1024 * 1024) } })).status, 413)
  assert.equal((await request('/api/v1/admin/campaigns', { method: 'POST', body: {}, admin: true })).status, 400)
  assert.equal((await request('/api/v1/admin/reports/example?version=-1')).status, 400)
  assert.equal((await request('/api/v1/admin/locales/absent', { method: 'PUT', body: {}, admin: true })).status, 404)
})

test('publicaciones concurrentes generan versiones únicas y permiten reutilizar el mismo afiche', async () => {
  const saved = await Promise.all(Array.from({ length: 5 }, () => service.saveCampaign(campaign('concurrent-campaign'))))
  assert.deepEqual(saved.map((row) => row.version).sort((a, b) => a - b), [1, 2, 3, 4, 5])
  const reused = await service.saveCampaign(campaign('other-campaign'))
  assert.equal(reused.version, 1)
  const latest = await request('/api/v1/admin/campaigns')
  assert.equal((await latest.json()).filter((row) => row.campaign_id === 'concurrent-campaign').length, 1)
  const versions = await request('/api/v1/admin/campaigns/concurrent-campaign/versions')
  assert.deepEqual((await versions.json()).map((row) => row.version), [5, 4, 3, 2, 1])
  const publicLookup = await request('/api/v1/public/campaigns/concurrent-campaign')
  assert.equal((await publicLookup.json()).status, 'ACTIVE')
})

test('D1 revierte campaña e imagen si la inserción final de contenido falla', async () => {
  await assert.rejects(() => repository.saveCampaign({
    campaign: { campaignId: 'rollback-campaign', localId: 'demo-locales-1', nombre: 'Rollback', estado: 'PUBLICADA', fechaInicio: new Date(), fechaFin: new Date('2099-12-31'), creadoPor: null, aprobadoPor: null },
    target: { targetId: 'rollback-target', nombreTecnico: 'cafe_altura', imagePath: 'l.png', thumbnailPath: '', originalPath: '', propertiesJson: '{}', contrastScore: 80, qrAccessUrl: '' },
    content: { tipoContenido: 'PANEL_INFORMATIVO', mediaUrl: 'p.png', mediaSizeBytes: 1024, mediaMimeType: null, tituloPromocion: 'Rollback', condicionesTexto: 'Test', ctaPrimariaLabel: 'Ver', ctaSecundariaLabel: 'Ir', ctaSecundariaUrl: '', overlayConfig: null },
  }), /NOT NULL/)
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM campanas WHERE campaign_id = 'rollback-campaign'").first('n'), 0)
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM imagenes_objetivo WHERE target_id = 'rollback-target'").first('n'), 0)
})

test('reintentos concurrentes persisten un único evento sin crear sesiones huérfanas', async () => {
  const responses = await Promise.all(Array.from({ length: 10 }, () => request('/api/v1/events', { method: 'POST', body: event('concurrent-event') })))
  assert.equal(responses.filter((response) => response.status === 201).length, 1)
  assert.equal(responses.filter((response) => response.status === 200).length, 9)
  const replay = await request('/api/v1/events', { method: 'POST', body: event('concurrent-event', { session_id: 'orphan-session' }) })
  assert.equal(replay.status, 200)
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM sesiones WHERE session_id = 'orphan-session'").first('n'), 0)
  const mismatch = await request('/api/v1/events', { method: 'POST', body: event('session-mismatch', { campaign_id: 'camp-iconic', campaign_version: 3 }) })
  assert.equal(mismatch.status, 400)
  const missing = await request('/api/v1/events', { method: 'POST', body: event('absent-campaign', { session_id: 'absent-session', campaign_id: 'absent' }) })
  assert.equal(missing.status, 400)
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM sesiones WHERE session_id = 'absent-session'").first('n'), 0)
})

test('los flags de sesión y el cierre se actualizan sin que un reintento los cambie', async () => {
  for (const type of ['CAMERA_READY', 'SCANNING_STARTED', 'SESSION_CLOSE']) {
    await service.ingestEvent(event(`flags-${type}`, { event_type: type }))
  }
  const row = await db.prepare("SELECT * FROM sesiones WHERE session_id = 'concurrent-session'").first()
  assert.equal(row.camera_ready, 1)
  assert.equal(row.scanning_started, 1)
  assert.ok(row.ended_at)
  await service.ingestEvent(event('flags-SESSION_CLOSE', { event_type: 'SESSION_CLOSE', client_time: `${date}T23:59:00Z` }))
  assert.equal(await db.prepare("SELECT ended_at FROM sesiones WHERE session_id = 'concurrent-session'").first('ended_at'), row.ended_at)
})

test('los 7 indicadores SQL coinciden con el cálculo original y conservan la historia por versión', async () => {
  const events = [
    ['SESSION_OPEN', {}], ['CAMERA_READY', {}], ['TARGET_FOUND', { timeToRecognitionMs: 1001 }],
    ['TARGET_FOUND', { timeToRecognitionMs: 9000 }], ['CONTENT_VIEWED', {}], ['CTA_CLICK', {}],
    ['TRACKING_INTERVAL_CLOSED', { intervalMs: 10000, isTracked: true, isVisible: true }],
    ['TRACKING_INTERVAL_CLOSED', { intervalMs: 3000, isTracked: false, isVisible: true }],
    ['TRACKING_INTERVAL_CLOSED', { intervalMs: 4000, isTracked: true, isVisible: false }],
    ['TARGET_LOST', {}], ['SESSION_ERROR', {}],
  ].map(([event_type, payload], index) => event(`metric-${index}`, {
    session_id: 'metrics-session', campaign_id: 'concurrent-campaign', campaign_version: 1,
    event_type, payload, client_time: new Date(Date.parse(`${date}T12:00:00Z`) + index * 1000).toISOString(),
  }))
  events.push(event('metric-second-session', { session_id: 'metrics-session-2', campaign_id: 'concurrent-campaign', event_type: 'SCANNING_STARTED' }))
  for (const item of events) await service.ingestEvent(item)
  const sql = await service.computeCampaignMetrics('concurrent-campaign', 1)
  assert.deepEqual(sql, computeMetricsFromEvents('concurrent-campaign', 1, events))
  const empty = await service.computeCampaignMetrics('concurrent-campaign', 5)
  assert.equal(empty.indicators.tasaReconocimientoPorSesion.formatted, 'No calculable (N/C)')
  const reports = await request('/api/v1/admin/reports')
  const report = (await reports.json()).find((row) => row.campaignId === 'concurrent-campaign' && row.version === 1)
  assert.equal(report.sessions, 2)
  assert.equal(report.trackingSec, 10)
})

test('el cliente HTTP no puede adelantar o atrasar la vigencia con fechas de prueba', async () => {
  const expired = { ...campaign('expired-http'), fecha_inicio: '2000-01-01', fecha_fin: '2000-12-31', referenceDate: '2000-01-02' }
  assert.equal((await request('/api/v1/admin/campaigns', { method: 'POST', body: expired, admin: true })).status, 400)
  await service.saveCampaign(expired, 'DIRECCION_MARKETING', '2000-01-02')
  const response = await request('/api/v1/public/campaigns/expired-http?date=2000-01-02')
  const result = await response.json()
  assert.equal(result.status, 'EXPIRED')
  assert.equal(result.showPromotionalMedia, false)
})

test('los parámetros con sintaxis SQL se tratan como datos', async () => {
  const response = await request(`/api/v1/public/campaigns/${encodeURIComponent("' OR 1=1 --")}`)
  assert.equal(response.status, 404)
  const originals = await request('/api/v1/admin/locales')
  assert.ok((await originals.json()).length >= 2)
})

test('los reportes soportan más de 50 campañas con consultas agrupadas', async () => {
  await db.batch(Array.from({ length: 55 }, (_, index) => db.prepare(`INSERT INTO campanas
    (campaign_id, version, local_id, nombre, estado, fecha_inicio, fecha_fin)
    VALUES (?, 1, 'demo-locales-1', ?, 'EN_PREPARACION', 0, 0)`).bind(`bulk-${index}`, `Bulk ${index}`)))
  const response = await request('/api/v1/admin/reports')
  assert.equal(response.status, 200)
  const reports = await response.json()
  assert.equal(reports.filter((row) => row.campaignId.startsWith('bulk-')).length, 55)
  assert.ok(reports.filter((row) => row.campaignId.startsWith('bulk-')).every((row) => row.sessions === 0))
})
