const crypto = require('node:crypto')
const cors = require('cors')

function configureSecurity(app, options = {}) {
  const production = options.production ?? process.env.NODE_ENV === 'production'
  const publicOrigin = options.publicOrigin ?? process.env.PUBLIC_ORIGIN
  const adminProxyToken = options.adminProxyToken ?? process.env.ADMIN_PROXY_TOKEN

  if (production) {
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(adminProxyToken || '')) {
      throw new Error('Producción requiere un ADMIN_PROXY_TOKEN aleatorio de al menos 32 caracteres.')
    }
    let origin
    try { origin = new URL(publicOrigin) } catch { /* Se rechaza abajo. */ }
    if (!origin || origin.protocol !== 'https:' || origin.origin !== publicOrigin) {
      throw new Error('Producción requiere PUBLIC_ORIGIN con un origen HTTPS, sin ruta ni barra final.')
    }
  }

  app.disable('x-powered-by')
  app.use('/api', (req, res, next) => {
    if (production && ((req.headers.origin && req.headers.origin !== publicOrigin) || req.headers['sec-fetch-site'] === 'cross-site')) {
      return res.status(403).json({ error: 'Origen no permitido.' })
    }
    next()
  })
  app.use(cors(production ? { origin: publicOrigin, methods: ['GET', 'HEAD', 'POST', 'PUT', 'OPTIONS'] } : undefined))

  // NGINX autentica al usuario y reemplaza estas cabeceras. El puerto de la
  // aplicación nunca debe publicarse; una cabecera de rol del cliente no basta.
  app.use('/api/v1/admin', (req, res, next) => {
    if (!production) {
      req.adminRole = req.headers['x-admin-role'] || 'VISITANTE_PUBLICO'
      return next()
    }
    const supplied = Buffer.from(req.get('X-Armodels-Admin-Token') || '')
    const expected = Buffer.from(adminProxyToken)
    if (!req.get('X-Armodels-Admin-User') || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
      return res.status(401).json({ error: 'Autenticación administrativa requerida.' })
    }
    req.adminRole = 'DIRECCION_MARKETING'
    next()
  })

  function sendError(res, err, defaultStatus = 400) {
    const proposed = err.statusCode || err.status || defaultStatus
    const status = Number.isInteger(proposed) && proposed >= 400 && proposed <= 599 ? proposed : 500
    const internal = status >= 500 || /^Prisma/.test(err.name || '') || /^P\d{4}$/.test(err.code || '')
    const message = production && internal ? 'No se pudo procesar la solicitud.' : err.message
    return res.status(status).json({ error: message })
  }

  return { production, sendError }
}

module.exports = { configureSecurity }
