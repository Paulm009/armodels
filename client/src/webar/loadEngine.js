/**
 * Carga dinámica del motor 8th Wall.
 * - Si VITE_8THWALL_APP_KEY está definida -> motor en la nube de 8th Wall (SLAM + Image Targets).
 * - Si no -> motor open-source desde CDN (Image Targets, sin SLAM, sin cuenta).
 */
let enginePromise = null

export function load8thWallEngine() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Sin entorno de navegador.'))
  if (enginePromise) return enginePromise

  enginePromise = new Promise((resolve, reject) => {
    if (window.XR8) return resolve(window.XR8)

    const appKey = import.meta.env.VITE_8THWALL_APP_KEY || ''
    const defaultSrc =
      import.meta.env.VITE_XR_ENGINE_SRC ||
      'https://cdn.jsdelivr.net/npm/@8thwall/engine@0.1.0/dist/xr.js'
    const src = appKey ? `https://apps.8thwall.com/xrweb?appKey=${appKey}` : defaultSrc

    const onLoaded = () => resolve(window.XR8)

    const existing = document.querySelector('script[data-xr-engine]')
    if (existing) {
      window.addEventListener('xrloaded', onLoaded)
      return
    }

    const script = document.createElement('script')
    script.async = true
    script.crossOrigin = 'anonymous'
    script.setAttribute('data-xr-engine', 'true')
    if (!appKey) script.setAttribute('data-preload-chunks', 'slam')
    script.src = src
    script.onerror = () => {
      enginePromise = null
      reject(new Error('No se pudo cargar el motor 8th Wall.'))
    }

    window.addEventListener('xrloaded', onLoaded)
    document.head.appendChild(script)
  })

  return enginePromise
}
