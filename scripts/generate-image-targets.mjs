/**
 * ============================================================================
 * GENERADOR DE IMAGE TARGETS REALES COMPATIBLES CON 8th WALL (open-source)
 * Utiliza el paquete oficial @8thwall/image-target-cli (applyCrop) para producir
 * la metadata JSON + luminancia (480x640) + miniatura (263x350) + recorte + original.
 *
 * También genera los afiches fuente (alta resolución, alto contraste) y los
 * paneles promocionales (overlay) que se muestran al reconocer el objetivo.
 *
 * Uso:  node scripts/generate-image-targets.mjs
 * ============================================================================
 */
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'
import { applyCrop } from '@8thwall/image-target-cli/src/apply.js'
import { getDefaultCrop } from '@8thwall/image-target-cli/src/crop.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const TARGETS_DIR = path.join(ROOT, 'image-targets')
const MEDIA_DIR = path.join(ROOT, 'public', 'media')

// PRNG determinista (mulberry32) para afiches reproducibles de alto detalle
function mulberry32(seed) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const GRAYS = ['#0a0a0a', '#1f1f1f', '#3d3d3d', '#6b6b6b', '#9a9a9a', '#c8c8c8', '#f2f2f2', '#ffffff']

function buildPosterSvg({ label, tagline, seed }) {
  const rand = mulberry32(seed)
  const w = 960
  const h = 1280
  const shapes = []
  // Fondo de alto contraste con bloques alternados
  const cell = 80
  for (let y = 0; y < h; y += cell) {
    for (let x = 0; x < w; x += cell) {
      const c = GRAYS[Math.floor(rand() * GRAYS.length)]
      shapes.push(`<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${c}" />`)
    }
  }
  // Detalle variado: círculos, diagonales y polígonos aleatorios
  for (let i = 0; i < 90; i++) {
    const cx = Math.floor(rand() * w)
    const cy = Math.floor(rand() * h)
    const r = 8 + Math.floor(rand() * 60)
    const c = GRAYS[Math.floor(rand() * GRAYS.length)]
    const kind = Math.floor(rand() * 3)
    if (kind === 0) {
      shapes.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}" />`)
    } else if (kind === 1) {
      shapes.push(`<rect x="${cx}" y="${cy}" width="${r}" height="${r}" fill="${c}" transform="rotate(${Math.floor(rand() * 360)} ${cx} ${cy})" />`)
    } else {
      shapes.push(`<path d="M ${cx} ${cy} L ${cx + r} ${cy - r} L ${cx + r * 2} ${cy} L ${cx + r} ${cy + r} Z" fill="${c}" />`)
    }
  }
  // Franja central y textos de alto contraste
  shapes.push(`<rect x="0" y="${h / 2 - 260}" width="${w}" height="520" fill="#111111" />`)
  shapes.push(`<rect x="40" y="${h / 2 - 220}" width="${w - 80}" height="440" fill="#ffffff" />`)
  shapes.push(`<text x="${w / 2}" y="${h / 2 - 130}" font-family="Arial, sans-serif" font-size="120" font-weight="900" text-anchor="middle" fill="#000000">${label}</text>`)
  shapes.push(`<text x="${w / 2}" y="${h / 2 + 20}" font-family="Arial, sans-serif" font-size="64" font-weight="700" text-anchor="middle" fill="#000000">${tagline}</text>`)
  shapes.push(`<text x="${w / 2}" y="${h / 2 + 110}" font-family="Arial, sans-serif" font-size="40" font-weight="400" text-anchor="middle" fill="#444444">PASEO ARANJUEZ</text>`)
  // Marco de borde con patrón para robustez de tracking
  for (let i = 0; i < 32; i++) {
    shapes.push(`<rect x="${Math.floor(rand() * (w - 40)) + 20}" y="${Math.floor(rand() * (h - 40)) + 20}" width="18" height="18" fill="#000000" opacity="0.55" />`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${shapes.join('')}</svg>`
}

function buildPromoPanelSvg({ title, body, accent }) {
  const w = 1024
  const h = 640
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#1b4332" />
  <rect x="24" y="24" width="${w - 48}" height="${h - 48}" fill="#f8f7f3" />
  <rect x="40" y="40" width="${w - 80}" height="120" fill="${accent}" />
  <text x="${w / 2}" y="120" font-family="Arial, sans-serif" font-size="64" font-weight="900" text-anchor="middle" fill="#0b1510">${title}</text>
  <text x="${w / 2}" y="300" font-family="Arial, sans-serif" font-size="44" font-weight="600" text-anchor="middle" fill="#18241e">${body}</text>
  <text x="${w / 2}" y="430" font-family="Arial, sans-serif" font-size="32" font-weight="400" text-anchor="middle" fill="#657069">Escanea el afiche del local para ver la oferta</text>
  <rect x="${w / 2 - 160}" y="480" width="320" height="76" rx="38" fill="#1b4332" />
  <text x="${w / 2}" y="530" font-family="Arial, sans-serif" font-size="34" font-weight="700" text-anchor="middle" fill="#ffffff">Ver condiciones</text>
</svg>`
}

const TARGETS = [
  {
    name: 'cafe_altura',
    label: 'CAFÉ ALTURA',
    tagline: '2 x 1 CAPUCHINOS',
    seed: 101,
    promo: { title: 'CAFÉ ALTURA', body: '2 × 1 en capuchinos medianos de lunes a viernes.', accent: '#d8e9b4' },
  },
  {
    name: 'iconic_models',
    label: 'ICONIC MODELS',
    tagline: 'NUEVA COLECCIÓN',
    seed: 202,
    promo: { title: 'ICONIC MODELS', body: 'Presentación de la nueva colección de temporada.', accent: '#e9efe7' },
  },
]

async function sourceImageFor(target) {
  const candidates = [`${target.name}.jpg`, `${target.name}.jpeg`, `${target.name}.png`]
  for (const file of candidates) {
    const p = path.join(TARGETS_DIR, file)
    try {
      const buf = await fs.readFile(p)
      const meta = await sharp(buf).metadata()
      if (meta.width >= 480 && meta.height >= 640) {
        return sharp(buf)
      }
    } catch {
      /* no existe, seguimos al procedural */
    }
  }
  const svg = buildPosterSvg(target)
  const png = await sharp(Buffer.from(svg), { density: 96 }).png().toBuffer()
  return sharp(png)
}

async function main() {
  await fs.mkdir(TARGETS_DIR, { recursive: true })
  await fs.mkdir(MEDIA_DIR, { recursive: true })

  for (const target of TARGETS) {
    const rawImage = await sourceImageFor(target)
    const meta = await rawImage.metadata()
    const sourceIsLandscape = meta.width >= meta.height
    const crop = { type: 'PLANAR', geometry: getDefaultCrop(meta, sourceIsLandscape) }
    const result = await applyCrop(rawImage, crop, TARGETS_DIR, target.name, true)
    console.log(`[target] ${target.name} -> ${result.dataPath}`)

    // Overlay promocional (contenido AR)
    const promoPng = await sharp(Buffer.from(buildPromoPanelSvg(target.promo)), { density: 96 })
      .png()
      .toBuffer()
    await fs.writeFile(path.join(MEDIA_DIR, `promo_${target.name}.png`), promoPng)
    console.log(`[media]  promo_${target.name}.png`)
  }
  console.log('Image targets y medios promocionales generados correctamente.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
