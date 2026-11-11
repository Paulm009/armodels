const API_BASE = import.meta.env.VITE_API_BASE_URL || ''
let adminToken = ''

async function request(path, { method = 'GET', body, admin = false } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (admin) {
    if (!adminToken) adminToken = window.prompt('Ingresa la clave de administración para guardar cambios:')?.trim() || ''
    if (!adminToken) throw new Error('Se requiere la clave de administración para guardar cambios.')
    headers.Authorization = `Bearer ${adminToken}`
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401) adminToken = ''
    const err = new Error(data.error || `Error ${res.status}`)
    err.status = res.status
    throw err
  }
  return data
}

export const api = {
  health: () => request('/api/v1/health'),

  // Locales
  listLocales: () => request('/api/v1/admin/locales'),
  createLocal: (data) => request('/api/v1/admin/locales', { method: 'POST', body: data, admin: true }),
  updateLocal: (id, data) => request(`/api/v1/admin/locales/${id}`, { method: 'PUT', body: data, admin: true }),

  // Campañas
  listCampaigns: (allVersions = false) =>
    request(`/api/v1/admin/campaigns${allVersions ? '?versions=all' : ''}`),
  listCampaignVersions: (id) => request(`/api/v1/admin/campaigns/${id}/versions`),
  createCampaign: (data) => request('/api/v1/admin/campaigns', { method: 'POST', body: data, admin: true }),

  // Público / WebAR
  getCampaign: (id) => request(`/api/v1/public/campaigns/${id}`),

  // Telemetría
  ingestEvent: (event) => request('/api/v1/events', { method: 'POST', body: event }),

  // Reportes
  listReports: () => request('/api/v1/admin/reports'),
  getReport: (id, version) =>
    request(`/api/v1/admin/reports/${id}${version ? `?version=${version}` : ''}`),
}

// Normaliza rutas de assets a absolutas (relativas a la raíz del servidor).
export function assetUrl(p) {
  if (!p) return ''
  if (p.startsWith('http') || p.startsWith('data:')) return p
  return p.startsWith('/') ? p : `/${p}`
}
