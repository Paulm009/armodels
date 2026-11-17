const API_BASE = import.meta.env.VITE_API_BASE_URL || ''
const TOKEN_KEY = 'paseo_webar_token'

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* almacenamiento bloqueado */
  }
}

function authHeaders() {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function notifyUnauthorized() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('webar:unauthorized'))
  }
}

async function request(path, { method = 'GET', body, keepalive = false } = {}) {
  const headers = { ...authHeaders() }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    keepalive,
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) {
    setToken(null)
    notifyUnauthorized()
  }
  if (!res.ok) {
    const err = new Error(data.error || `Error ${res.status}`)
    err.status = res.status
    throw err
  }
  return data
}

async function uploadFile(path, file, field = 'file') {
  const form = new FormData()
  form.append(field, file)
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) {
    setToken(null)
    notifyUnauthorized()
  }
  if (!res.ok) {
    const err = new Error(data.error || `Error ${res.status}`)
    err.status = res.status
    throw err
  }
  return data
}

export const api = {
  health: () => request('/api/v1/health'),

  // Autenticación
  login: async (usuario, password) => {
    const data = await request('/api/v1/auth/login', { method: 'POST', body: { usuario, password } })
    setToken(data.token)
    return data
  },
  me: () => request('/api/v1/auth/me'),
  logout: async () => {
    try {
      await request('/api/v1/auth/logout', { method: 'POST' })
    } finally {
      setToken(null)
    }
  },

  // Locales
  listLocales: () => request('/api/v1/admin/locales'),
  createLocal: (data) => request('/api/v1/admin/locales', { method: 'POST', body: data }),
  updateLocal: (id, data) => request(`/api/v1/admin/locales/${id}`, { method: 'PUT', body: data }),

  // Campañas
  listCampaigns: (allVersions = false) =>
    request(`/api/v1/admin/campaigns${allVersions ? '?versions=all' : ''}`),
  listCampaignVersions: (id) => request(`/api/v1/admin/campaigns/${id}/versions`),
  createCampaign: (data) => request('/api/v1/admin/campaigns', { method: 'POST', body: data }),
  updateCampaignStatus: (id, estado) =>
    request(`/api/v1/admin/campaigns/${id}/status`, { method: 'PATCH', body: { estado } }),
  updateCampaignContent: (id, content) =>
    request(`/api/v1/admin/campaigns/${id}/content`, { method: 'PUT', body: content }),

  // Image targets y medios AR
  listImageTargets: () => request('/api/v1/admin/image-targets'),
  createImageTarget: (file) => uploadFile('/api/v1/admin/image-targets', file),
  uploadMedia: (file) => uploadFile('/api/v1/admin/media', file),

  // Público / WebAR
  getCampaign: (id) => request(`/api/v1/public/campaigns/${encodeURIComponent(id)}`),
  qrUrl: (id, size = 512) => `${API_BASE}/api/v1/public/campaigns/${encodeURIComponent(id)}/qr?size=${size}`,

  // Telemetría
  ingestEvent: (event, { keepalive = false } = {}) =>
    request('/api/v1/events', { method: 'POST', body: event, keepalive }),

  // Reportes
  listReports: (allVersions = false) =>
    request(`/api/v1/admin/reports${allVersions ? '?versions=all' : ''}`),
  getReport: (id, version) =>
    request(`/api/v1/admin/reports/${encodeURIComponent(id)}${version ? `?version=${version}` : ''}`),
}

// Normaliza rutas de assets a absolutas (relativas a la raíz del servidor).
export function assetUrl(p) {
  if (!p) return ''
  if (p.startsWith('http') || p.startsWith('data:')) return p
  return p.startsWith('/') ? p : `/${p}`
}
