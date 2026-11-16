/**
 * Carga dinámica del motor 8th Wall.
 * - Si VITE_8THWALL_APP_KEY está definida -> motor en la nube de 8th Wall (SLAM + Image Targets).
 * - Si no -> motor open-source desde CDN (Image Targets, sin SLAM, sin cuenta).
 *
 * La promesa se cachea en `enginePromise` para que solo se cargue una vez por página.
 */
let enginePromise = null

const LOAD_TIMEOUT_MS = 30000

// El `XrController` (el que hace Image Tracking) NO viene en el bundle base del
// motor: se publica como chunk aparte (`xr-tracking.js`). Si no se precarga,
// `XR8.XrController` queda en `null` y `XrController.configure()` lanza
// "null is not an object (evaluating 't.XrController.configure')".
const TRACKING_CHUNK = 'slam'

async function ensureTrackingChunk(XR8) {
  if (!XR8) throw new Error('No se pudo inicializar el motor 8th Wall.')
  if (XR8.XrController) return XR8
  if (typeof XR8.loadChunk !== 'function') {
    throw new Error('El motor 8th Wall no expone el controlador de tracking.')
  }
  await XR8.loadChunk({ name: TRACKING_CHUNK })
  if (!XR8.XrController) {
    throw new Error('El controlador de tracking de 8th Wall no pudo inicializarse.')
  }
  return XR8
}

export function load8thWallEngine() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Sin entorno de navegador.'))
  if (enginePromise) return enginePromise
  if (window.XR8) {
    enginePromise = ensureTrackingChunk(window.XR8)
    return enginePromise
  }

  enginePromise = new Promise((resolve, reject) => {
    const appKey = import.meta.env.VITE_8THWALL_APP_KEY || ''
    const defaultSrc =
      import.meta.env.VITE_XR_ENGINE_SRC ||
      'https://cdn.jsdelivr.net/npm/@8thwall/engine@0.1.0/dist/xr.js'
    const src = appKey ? `https://apps.8thwall.com/xrweb?appKey=${appKey}` : defaultSrc

    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      window.removeEventListener('xrloaded', onLoaded)
      fn(value)
    }
    const onLoaded = () => finish(resolve, window.XR8)
    const onError = () => finish(reject, new Error('No se pudo cargar el motor 8th Wall.'))

    // Si ya existe un script del motor en el documento, reutilizamos su carga.
    const existing = document.querySelector('script[data-xr-engine]')
    if (existing) {
      window.addEventListener('xrloaded', onLoaded)
      return
    }

    const script = document.createElement('script')
    script.async = true
    script.crossOrigin = 'anonymous'
    script.setAttribute('data-xr-engine', 'true')
    // `XrController` viaja en el chunk "slam" (es el mismo que resuelve Image
    // Tracking). Hay que precargarlo o el motor arranca sin controlador.
    script.setAttribute('data-preload-chunks', TRACKING_CHUNK)
    script.src = src
    script.onerror = onError

    window.addEventListener('xrloaded', onLoaded)
    document.head.appendChild(script)

    setTimeout(() => {
      if (!window.XR8) {
        enginePromise = null
        finish(reject, new Error('Tiempo de espera agotado al cargar el motor 8th Wall.'))
      }
    }, LOAD_TIMEOUT_MS)
  }).then(ensureTrackingChunk)

  return enginePromise
}
