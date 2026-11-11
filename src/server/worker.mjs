import { PaseoAranjuezCoreService } from './core-service.js'
import { D1Repository } from './d1-repository.js'

const MAX_BODY_BYTES = 1024 * 1024

function fail(message, statusCode) {
  return Object.assign(new Error(message), { statusCode })
}

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  })
}

async function readBody(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw fail('Se requiere Content-Type: application/json.', 415)
  }
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) {
    throw fail('El cuerpo excede el límite de 1 MB.', 413)
  }
  const reader = request.body?.getReader()
  if (!reader) throw fail('El cuerpo JSON es obligatorio.', 400)
  const decoder = new TextDecoder()
  let size = 0
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY_BYTES) {
        await reader.cancel()
        throw fail('El cuerpo excede el límite de 1 MB.', 413)
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    const body = JSON.parse(text)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error()
    return body
  } catch (error) {
    if (error.statusCode) throw error
    throw fail('El cuerpo debe ser un objeto JSON válido.', 400)
  } finally {
    reader.releaseLock()
  }
}

async function requireAdmin(request, env) {
  if (!env.ADMIN_TOKEN) throw fail('La clave de administración no está configurada.', 503)
  const authorization = request.headers.get('authorization') || ''
  if (!authorization.startsWith('Bearer ') || authorization.length > 1024) {
    throw fail('Se requiere una clave de administración válida.', 401)
  }
  const encoder = new TextEncoder()
  const [expected, supplied] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(env.ADMIN_TOKEN)),
    crypto.subtle.digest('SHA-256', encoder.encode(authorization.slice(7))),
  ])
  const bytes = new Uint8Array(supplied)
  let difference = 0
  new Uint8Array(expected).forEach((byte, index) => { difference |= byte ^ bytes[index] })
  if (difference !== 0) throw fail('La clave de administración es incorrecta.', 401)
  // El rol se decide en el servidor; x-admin-role nunca concede permisos.
  return 'DIRECCION_MARKETING'
}

function positiveVersion(value) {
  if (value === null) return null
  const version = Number(value)
  if (!Number.isInteger(version) || version < 1) throw fail('Versión inválida.', 400)
  return version
}

async function handleAPI(request, env, url) {
  const path = url.pathname.replace(/\/$/, '')
  const method = request.method === 'HEAD' ? 'GET' : request.method
  const repository = new D1Repository(env.DB)
  const service = new PaseoAranjuezCoreService(repository, async (name) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) return null
    const response = await env.ASSETS.fetch(new Request(new URL(`/image-targets/${name}.json`, url)))
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return null
    return response.json()
  })
  const match = (pattern) => path.match(pattern)?.slice(1).map(decodeURIComponent)
  const requireMethod = (...allowed) => {
    if (!allowed.includes(method)) throw fail('Método no permitido.', 405)
  }

  if (path === '/api/v1/health') {
    requireMethod('GET')
    await env.DB.prepare('SELECT 1').first()
    return json({ ok: true, service: 'paseo-aranjuez-webar', runtime: 'cloudflare-workers', database: 'd1' })
  }
  const visitor = match(/^\/api\/v1\/public\/campaigns\/([^/]+)$/)
  if (visitor) {
    requireMethod('GET')
    const result = await service.getActiveCampaignForVisitor(visitor[0])
    return json(result, result.found ? 200 : 404)
  }
  if (path === '/api/v1/events') {
    requireMethod('POST')
    const result = await service.ingestEvent(await readBody(request))
    return json(result, result.deduplicated ? 200 : 201)
  }
  if (path === '/api/v1/admin/locales') {
    requireMethod('GET', 'POST')
    if (method === 'GET') return json(await service.listLocales())
    const role = await requireAdmin(request, env)
    return json(await service.registerLocal(await readBody(request), role), 201)
  }
  const local = match(/^\/api\/v1\/admin\/locales\/([^/]+)$/)
  if (local) {
    requireMethod('PUT')
    const role = await requireAdmin(request, env)
    return json(await service.updateLocal(local[0], await readBody(request), role))
  }
  if (path === '/api/v1/admin/campaigns') {
    requireMethod('GET', 'POST')
    if (method === 'GET') return json(await service.listCampaigns({ latestOnly: url.searchParams.get('versions') !== 'all' }))
    const role = await requireAdmin(request, env)
    // Las fechas de referencia para pruebas solo existen en el servicio,
    // nunca pueden alterar la vigencia desde una petición pública.
    return json(await service.saveCampaign(await readBody(request), role), 201)
  }
  const versions = match(/^\/api\/v1\/admin\/campaigns\/([^/]+)\/versions$/)
  if (versions) {
    requireMethod('GET')
    return json(await service.listCampaignVersions(versions[0]))
  }
  if (path === '/api/v1/admin/reports') {
    requireMethod('GET')
    return json(await service.listReports())
  }
  const report = match(/^\/api\/v1\/admin\/reports\/([^/]+)$/)
  if (report) {
    requireMethod('GET')
    return json(await service.computeCampaignMetrics(report[0], positiveVersion(url.searchParams.get('version'))))
  }
  return json({ error: 'Ruta API no encontrada.' }, 404)
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      try {
        const response = await handleAPI(request, env, url)
        return request.method === 'HEAD' ? new Response(null, response) : response
      } catch (error) {
        const constraint = /(?:UNIQUE|FOREIGN KEY|CHECK|NOT NULL) constraint failed/.test(error.message)
        const status = error.statusCode || (constraint ? 409 : error instanceof URIError ? 400 : 500)
        if (status === 500) console.error('API failure', error)
        return json({ error: status === 500 ? 'No se pudo completar la operación.'
          : constraint ? 'Los datos entran en conflicto con un registro existente.' : error.message }, status)
      }
    }
    const asset = await env.ASSETS.fetch(request)
    // Los assets existentes se sirven directamente por Cloudflare. Solo las
    // rutas de navegación inexistentes llegan aquí para resolver la SPA.
    if (asset.status === 404 && ['GET', 'HEAD'].includes(request.method)
      && request.headers.get('accept')?.includes('text/html')
      && !/^\/(?:media|image-targets|assets)(?:\/|$)/.test(url.pathname)) {
      return env.ASSETS.fetch(new Request(new URL('/index.html', url), request))
    }
    return asset
  },
}
