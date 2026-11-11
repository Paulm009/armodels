const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createServer } = require('../src/server/app')
const { PaseoAranjuezCoreService } = require('../src/server/core-service')

const token = 'test-only-proxy-token-with-at-least-32-characters'
const options = { production: true, publicOrigin: 'https://armodels.example', adminProxyToken: token }

async function withServer(service, run) {
  const server = createServer(service, options).listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  try {
    await run(`http://127.0.0.1:${server.address().port}`)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()))
  }
}

test('production refuses incomplete security configuration', () => {
  assert.throws(() => createServer({}, { ...options, adminProxyToken: '' }), /ADMIN_PROXY_TOKEN/)
  assert.throws(() => createServer({}, { ...options, publicOrigin: 'http://example.com' }), /PUBLIC_ORIGIN/)
})

test('client-controlled roles and partial proxy credentials cannot access administration', async () => {
  await withServer({}, async (base) => {
    for (const headers of [
      { 'x-admin-role': 'DIRECCION_MARKETING' },
      { 'X-Armodels-Admin-User': 'admin', 'X-Armodels-Admin-Token': 'wrong' },
      { 'X-Armodels-Admin-Token': token },
    ]) {
      const response = await fetch(`${base}/API/v1/ADMIN/locales`, { headers })
      assert.equal(response.status, 401)
    }
  })
})

test('authenticated proxy grants its fixed role and ignores a forged client role', async () => {
  let receivedRole
  await withServer({ registerLocal: async (body, role) => { receivedRole = role; return { id: 'test' } } }, async (base) => {
    const response = await fetch(`${base}/api/v1/admin/locales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Armodels-Admin-User': 'admin', 'X-Armodels-Admin-Token': token, 'x-admin-role': 'GERENCIA' },
      body: JSON.stringify({ nombre: 'Test' }),
    })
    assert.equal(response.status, 201)
    assert.equal(receivedRole, 'DIRECCION_MARKETING')
    assert.equal(response.headers.get('x-powered-by'), null)
  })
})

test('cross-origin and cross-site API requests are rejected', async () => {
  await withServer({}, async (base) => {
    for (const headers of [{ Origin: 'https://attacker.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
      assert.equal((await fetch(`${base}/api/v1/health`, { headers })).status, 403)
    }
    const response = await fetch(`${base}/api/v1/health`, { headers: { Origin: options.publicOrigin } })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), options.publicOrigin)
  })
})

test('public requests cannot override the production campaign date', async () => {
  let suppliedDate = 'not-called'
  await withServer({ getActiveCampaignForVisitor: async (id, date) => { suppliedDate = date; return { found: true } } }, async (base) => {
    assert.equal((await fetch(`${base}/api/v1/public/campaigns/test?date=2000-01-01`)).status, 200)
    assert.equal(suppliedDate, undefined)
  })
})

test('production does not reveal internal errors', async () => {
  await withServer({ listLocales: async () => { throw new Error('secret path /var/lib/private.db') } }, async (base) => {
    const response = await fetch(`${base}/api/v1/admin/locales`, { headers: { 'X-Armodels-Admin-User': 'admin', 'X-Armodels-Admin-Token': token } })
    assert.equal(response.status, 500)
    assert.deepEqual(await response.json(), { error: 'No se pudo procesar la solicitud.' })
  })
})

test('compressed and oversized request bodies are rejected before ingestion', async () => {
  await withServer({ ingestEvent: async () => { throw new Error('must not be called') } }, async (base) => {
    const compressed = await fetch(`${base}/api/v1/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, body: 'compressed-data' })
    assert.equal(compressed.status, 415)
    const oversized = await fetch(`${base}/api/v1/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload: 'x'.repeat(1024 * 1024) }) })
    assert.equal(oversized.status, 413)
  })
})

test('image metadata cannot traverse outside its directory', () => {
  const service = new PaseoAranjuezCoreService({})
  for (const name of ['../../package', '..\\..\\package', '/etc/config', 'valid/../invalid']) {
    assert.throws(() => service.readTargetMetadata({ nombre_tecnico: name }), /inválido/)
  }
  assert.equal(service.readTargetMetadata({ nombre_tecnico: 'cafe_altura' }).name, 'cafe_altura')
})

test('oversized telemetry identifiers and payloads fail before database access', async () => {
  const service = new PaseoAranjuezCoreService({})
  const event = { event_id: 'event', session_id: 'session', campaign_id: 'campaign', campaign_version: 1, event_type: 'SESSION_OPEN', client_time: '2026-11-11T18:00:00Z' }
  await assert.rejects(service.ingestEvent({ ...event, event_id: 'x'.repeat(161) }), /inválido/)
  await assert.rejects(service.ingestEvent({ ...event, payload: { data: 'x'.repeat(8193) } }), /inválido/)
  await assert.rejects(service.ingestEvent({ ...event, campaign_version: -1 }), /inválido/)
  await assert.rejects(service.ingestEvent({ ...event, client_time: 'invalid' }), /inválido/)
})
