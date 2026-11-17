/**
 * Detección de capacidades del navegador para WebAR con 8th Wall.
 *
 * Requisitos oficiales del motor:
 *  - HTTPS (o localhost)
 *  - WebGL / WebGL2
 *  - navigator.mediaDevices.getUserMedia
 *  - WebAssembly SIMD
 *  - Safari en iOS 16.4+ (WKWebView en iOS 14.3+)
 */

const IOS_SAFARI_MIN = { major: 16, minor: 4 }
const IOS_WEBVIEW_MIN = { major: 14, minor: 3 }

// Módulo WASM mínimo que usa una instrucción SIMD (v128). Si el navegador no
// soporta SIMD, WebAssembly.validate devuelve false o lanza.
const SIMD_TEST_MODULE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
])

export function detectCapabilities(navigatorRef = typeof navigator !== 'undefined' ? navigator : null, windowRef = typeof window !== 'undefined' ? window : null) {
  const ua = navigatorRef?.userAgent || ''
  const platform = detectPlatform(ua, navigatorRef)
  const browser = detectBrowser(ua)
  const iosVersion = platform.family === 'ios' ? parseIOSVersion(ua, navigatorRef) : null
  const inAppBrowser = detectInAppBrowser(ua)
  const secureContext = Boolean(windowRef?.isSecureContext) || isLocalhost(windowRef?.location?.hostname)
  const hasCameraApi = Boolean(navigatorRef?.mediaDevices && typeof navigatorRef.mediaDevices.getUserMedia === 'function')
  const webgl = detectWebGL(windowRef)
  const wasm = detectWasmSimd(windowRef)

  const blockers = []
  const warnings = []

  if (!secureContext) {
    blockers.push({
      code: 'INSECURE_CONTEXT',
      message: 'La cámara solo funciona en HTTPS o localhost. Abre la experiencia con una dirección https:// (por ejemplo, un túnel) e inténtalo de nuevo.',
    })
  }
  if (!hasCameraApi) {
    blockers.push({
      code: 'NO_CAMERA_API',
      message: 'Este navegador no expone el acceso a la cámara. Actualiza el navegador o abre la página en Safari/Chrome.',
    })
  }
  if (!webgl) {
    blockers.push({
      code: 'NO_WEBGL',
      message: 'El dispositivo no tiene WebGL disponible. La experiencia AR no puede renderizarse.',
    })
  }
  if (!wasm) {
    blockers.push({
      code: 'NO_WASM_SIMD',
      message: 'El navegador no soporta WebAssembly SIMD, requerido por el motor 8th Wall. Actualiza el sistema operativo y el navegador.',
    })
  }

  if (platform.family === 'ios') {
    const safari = browser.name === 'Safari'
    const min = safari ? IOS_SAFARI_MIN : IOS_WEBVIEW_MIN
    if (iosVersion && compareVersions(iosVersion, min) < 0) {
      blockers.push({
        code: safari ? 'IOS_SAFARI_TOO_OLD' : 'IOS_WEBVIEW_TOO_OLD',
        message: safari
          ? `Safari en iOS ${formatVersion(iosVersion)} no es compatible con 8th Wall. Se requiere iOS 16.4 o superior.`
          : `Este navegador en iOS ${formatVersion(iosVersion)} no es compatible con 8th Wall. Se requiere iOS 14.3 o superior; para Safari, iOS 16.4 o superior.`,
      })
    } else if (!safari && iosVersion && compareVersions(iosVersion, IOS_SAFARI_MIN) < 0) {
      warnings.push({
        code: 'IOS_BELOW_SAFARI_MIN',
        message: `Estás en un navegador basado en WebKit con iOS ${formatVersion(iosVersion)}. Puede funcionar, pero para mayor estabilidad usa Safari con iOS 16.4 o superior.`,
      })
    }
  }

  if (inAppBrowser) {
    warnings.push({
      code: 'IN_APP_BROWSER',
      message: 'Estás dentro de un navegador integrado (Instagram, WhatsApp, Facebook u otro). La cámara y WebGL pueden fallar. Abre el enlace en Safari o Chrome.',
    })
  }
  if (platform.family === 'desktop') {
    warnings.push({
      code: 'DESKTOP',
      message: 'Estás en escritorio. La experiencia está pensada para teléfonos; la cámara puede no estar disponible o ser distinta.',
    })
  }
  if (!iosVersion && platform.family === 'ios') {
    warnings.push({
      code: 'IOS_VERSION_UNKNOWN',
      message: 'No se pudo determinar la versión de iOS. Si la experiencia no inicia, actualiza a iOS 16.4 o superior.',
    })
  }

  return {
    supported: blockers.length === 0,
    blockers,
    warnings,
    platform,
    browser,
    iosVersion,
    inAppBrowser,
    secureContext,
    hasCameraApi,
    webgl,
    wasmSimd: wasm,
    userAgent: ua,
  }
}

function detectPlatform(ua, navigatorRef) {
  if (/Android/i.test(ua)) return { family: 'android', label: 'Android' }
  const iPadOS = navigatorRef?.platform === 'MacIntel' && (navigatorRef?.maxTouchPoints || 0) > 1
  if (/iPad|iPhone|iPod/i.test(ua) || iPadOS) return { family: 'ios', label: 'iOS' }
  if (/Windows|Macintosh|Linux|CrOS/i.test(ua)) return { family: 'desktop', label: 'Escritorio' }
  return { family: 'other', label: 'Otro' }
}

function detectBrowser(ua) {
  if (/CriOS/i.test(ua)) return { name: 'Chrome', version: versionFrom(ua, /CriOS\/([\d.]+)/) }
  if (/FxiOS/i.test(ua)) return { name: 'Firefox', version: versionFrom(ua, /FxiOS\/([\d.]+)/) }
  if (/EdgiOS/i.test(ua)) return { name: 'Edge', version: versionFrom(ua, /EdgiOS\/([\d.]+)/) }
  if (/OPiOS/i.test(ua)) return { name: 'Opera', version: versionFrom(ua, /OPiOS\/([\d.]+)/) }
  if (/Chrome\//i.test(ua)) return { name: 'Chrome', version: versionFrom(ua, /Chrome\/([\d.]+)/) }
  if (/Firefox\//i.test(ua)) return { name: 'Firefox', version: versionFrom(ua, /Firefox\/([\d.]+)/) }
  if (/Edg\//i.test(ua)) return { name: 'Edge', version: versionFrom(ua, /Edg\/([\d.]+)/) }
  if (/Safari\//i.test(ua)) return { name: 'Safari', version: versionFrom(ua, /Version\/([\d.]+)/) }
  return { name: 'Desconocido', version: null }
}

function detectInAppBrowser(ua) {
  return /FBAN|FBAV|FB_IAB|Instagram|Line\/|WhatsApp|Twitter|LinkedInApp|Snapchat|Pinterest|MicroMessenger|GSA\//i.test(ua)
}

function parseIOSVersion(ua, navigatorRef) {
  const match = ua.match(/OS (\d+)[._](\d+)(?:[._](\d+))?/) || ua.match(/CPU iPhone OS (\d+)[._](\d+)/)
  if (match) return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3] || 0) }
  // iPadOS 13+ se presenta como MacIntel y no expone la versión de iOS en el UA.
  // Devolvemos null para no asumir una versión compatible.
  return null
}

function versionFrom(ua, regex) {
  const match = ua.match(regex)
  return match ? match[1] : null
}

function compareVersions(a, b) {
  if (a.major !== b.major) return a.major - b.major
  return a.minor - b.minor
}

function formatVersion(v) {
  return `${v.major}.${v.minor}`
}

function isLocalhost(hostname) {
  if (!hostname) return false
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function detectWebGL(windowRef) {
  if (!windowRef?.document) return null
  try {
    const canvas = windowRef.document.createElement('canvas')
    if (canvas.getContext('webgl2')) return 'webgl2'
    if (canvas.getContext('webgl')) return 'webgl'
  } catch {
    return null
  }
  return null
}

function detectWasmSimd(windowRef) {
  const WebAssemblyRef = windowRef?.WebAssembly
  if (!WebAssemblyRef || typeof WebAssemblyRef.validate !== 'function') return false
  try {
    return WebAssemblyRef.validate(SIMD_TEST_MODULE)
  } catch {
    return false
  }
}

export function summarizeCapabilities(capabilities) {
  if (!capabilities) return ''
  const parts = []
  if (capabilities.iosVersion) parts.push(`iOS ${formatVersion(capabilities.iosVersion)}`)
  else parts.push(capabilities.platform.label)
  parts.push(capabilities.browser.name)
  if (capabilities.webgl) parts.push(capabilities.webgl.toUpperCase())
  return parts.join(' · ')
}

export { IOS_SAFARI_MIN, IOS_WEBVIEW_MIN }
