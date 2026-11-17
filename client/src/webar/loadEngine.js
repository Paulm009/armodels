/**
 * Carga dinámica y reintentable del motor 8th Wall.
 *
 * - Si VITE_8THWALL_APP_KEY está definida, se usa la distribución indicada por
 *   la aplicación (compatibilidad con instalaciones existentes).
 * - Si no, se usa el motor open-source desde CDN o la URL configurada en
 *   VITE_XR_ENGINE_SRC.
 *
 * El `XrController` de Image Tracking viaja como chunk (`slam`). Se precarga
 * con `data-preload-chunks="slam"` y, si hiciera falta, con `XR8.loadChunks`.
 * La promesa se cachea solo cuando la carga termina bien; si falla, se limpia
 * para permitir un reintento real desde la interfaz.
 */

const ENGINE_VERSION = '0.1.0'
export const DEFAULT_ENGINE_SRC = `https://cdn.jsdelivr.net/npm/@8thwall/engine@${ENGINE_VERSION}/dist/xr.js`
const LOAD_TIMEOUT_MS = 45000
const CHUNK_TIMEOUT_MS = 15000
const TRACKING_CHUNK = 'slam'

let enginePromise = null

function emit(onProgress, stage, message) {
  if (typeof onProgress === 'function') {
    try {
      onProgress({ stage, message })
    } catch {
      /* la interfaz nunca debe romper la carga */
    }
  }
}

export function load8thWallEngine({ onProgress, forceReload = false } = {}) {
  if (typeof window === 'undefined') return Promise.reject(new Error('Sin entorno de navegador.'))
  if (forceReload) {
    enginePromise = null
  }
  if (enginePromise) {
    emit(onProgress, 'reuse', 'Reutilizando el motor ya cargado…')
    return enginePromise
  }

  emit(onProgress, 'start', 'Cargando el motor de realidad aumentada…')

  enginePromise = loadScript({ onProgress })
    .then((XR8) => ensureTrackingChunk(XR8, onProgress))
    .then((XR8) => {
      emit(onProgress, 'ready', 'Motor listo.')
      return XR8
    })
    .catch((error) => {
      enginePromise = null
      emit(onProgress, 'error', error.message)
      throw error
    })

  return enginePromise
}

function loadScript({ onProgress }) {
  return new Promise((resolve, reject) => {
    if (window.XR8) {
      emit(onProgress, 'script', 'El motor ya estaba presente en la página.')
      resolve(window.XR8)
      return
    }

    const appKey = import.meta.env.VITE_8THWALL_APP_KEY || ''
    const configuredSrc = import.meta.env.VITE_XR_ENGINE_SRC || DEFAULT_ENGINE_SRC
    const src = appKey ? `https://apps.8thwall.com/xrweb?appKey=${encodeURIComponent(appKey)}` : configuredSrc

    let settled = false
    let timer = null
    let script = null

    const onLoaded = () => {
      if (!window.XR8) return
      finish(resolve, window.XR8)
    }
    const onError = () => {
      if (script && script.parentNode) script.parentNode.removeChild(script)
      finish(reject, new Error('No se pudo descargar el motor 8th Wall. Revisa la conexión e inténtalo de nuevo.'))
    }
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      window.removeEventListener('xrloaded', onLoaded)
      fn(value)
    }

    window.addEventListener('xrloaded', onLoaded, { once: true })

    const existing = document.querySelector('script[data-xr-engine]')
    if (existing) {
      emit(onProgress, 'script', 'Esperando el motor que ya se está cargando…')
      timer = setTimeout(() => {
        if (window.XR8) onLoaded()
        else finish(reject, new Error('El motor 8th Wall tardó demasiado en cargar. Inténtalo de nuevo.'))
      }, LOAD_TIMEOUT_MS)
      return
    }

    script = document.createElement('script')
    script.async = true
    script.crossOrigin = 'anonymous'
    script.setAttribute('data-xr-engine', 'true')
    script.setAttribute('data-preload-chunks', TRACKING_CHUNK)
    script.src = src
    script.onerror = onError
    script.onload = () => {
      // Algunas versiones no emiten `xrloaded` si el script se carga desde caché.
      if (window.XR8) onLoaded()
    }

    emit(onProgress, 'script', 'Descargando el motor 8th Wall…')
    document.head.appendChild(script)

    timer = setTimeout(() => {
      finish(reject, new Error('Tiempo de espera agotado al cargar el motor 8th Wall. Comprueba tu conexión e inténtalo de nuevo.'))
    }, LOAD_TIMEOUT_MS)
  })
}

async function ensureTrackingChunk(XR8, onProgress) {
  if (!XR8) throw new Error('No se pudo inicializar el motor 8th Wall.')
  if (XR8.XrController) return XR8

  emit(onProgress, 'chunk', 'Preparando el seguimiento de imágenes…')

  const loaders = []
  if (typeof XR8.loadChunks === 'function') {
    loaders.push(() => XR8.loadChunks({ name: TRACKING_CHUNK }))
    loaders.push(() => XR8.loadChunks(TRACKING_CHUNK))
  }
  if (typeof XR8.loadChunk === 'function') {
    loaders.push(() => XR8.loadChunk({ name: TRACKING_CHUNK }))
    loaders.push(() => XR8.loadChunk(TRACKING_CHUNK))
  }

  for (const load of loaders) {
    try {
      await load()
      if (XR8.XrController) return XR8
    } catch {
      /* se prueba la siguiente variante */
    }
  }

  // El atributo data-preload-chunks puede terminar después del evento xrloaded.
  const controller = await waitFor(() => XR8.XrController, CHUNK_TIMEOUT_MS)
  if (!controller) {
    throw new Error('El controlador de seguimiento de imágenes no pudo inicializarse. Actualiza el navegador o inténtalo de nuevo.')
  }
  return XR8
}

function waitFor(predicate, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now()
    const tick = () => {
      const value = predicate()
      if (value) return resolve(value)
      if (Date.now() - started >= timeoutMs) return resolve(null)
      setTimeout(tick, 120)
    }
    tick()
  })
}
