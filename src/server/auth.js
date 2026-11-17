/**
 * Autenticación y autorización con criptografía nativa de Node.
 *
 * - Contraseñas: scrypt con sal aleatoria.
 * - Sesión: token firmado con HMAC-SHA256 (formato propio, sin dependencias).
 * - Roles: se verifican en cada solicitud administrativa.
 */
const crypto = require('crypto')

const DEFAULT_SECRET = 'cambia-este-secreto-en-produccion'
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000

function getSecret() {
  return process.env.AUTH_SECRET || process.env.JWT_SECRET || DEFAULT_SECRET
}

function base64url(value) {
  return Buffer.from(value).toString('base64url')
}

function fromBase64url(value) {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function hmac(data) {
  return crypto.createHmac('sha256', getSecret()).update(data).digest('base64url')
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a))
  const bufB = Buffer.from(String(b))
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

function signToken(payload) {
  const body = {
    ...payload,
    exp: Date.now() + TOKEN_TTL_MS,
  }
  const data = base64url(JSON.stringify(body))
  return `${data}.${hmac(data)}`
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null
  const [data, signature] = token.split('.')
  if (!data || !signature) return null
  if (!safeEqual(signature, hmac(data))) return null
  try {
    const payload = JSON.parse(fromBase64url(data))
    if (!payload || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex')
  return `scrypt$${salt}$${hash}`
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false
  const [scheme, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const candidate = crypto.scryptSync(String(password), salt, 64).toString('hex')
  return safeEqual(candidate, hash)
}

function extractToken(req) {
  const header = req.headers.authorization || ''
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim()
  const cookie = req.headers.cookie || ''
  const match = cookie.match(/(?:^|;\s*)webar_session=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : null
}

function requireAuth(req, res, next) {
  if (process.env.AUTH_DISABLED === 'true') {
    req.user = { id: 'dev', usuario: 'dev', nombre: 'Modo demostración', rol: 'DIRECCION_MARKETING' }
    return next()
  }
  const token = extractToken(req)
  const payload = verifyToken(token)
  if (!payload) {
    return res.status(401).json({ error: 'Sesión no válida o expirada. Inicia sesión de nuevo.' })
  }
  req.user = payload
  return next()
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.rol)) {
      return res.status(403).json({ error: 'No tienes permisos para ejecutar esta operación.' })
    }
    return next()
  }
}

module.exports = {
  signToken,
  verifyToken,
  hashPassword,
  verifyPassword,
  requireAuth,
  requireRole,
  extractToken,
}
