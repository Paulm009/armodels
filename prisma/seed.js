/**
 * ============================================================================
 * SEED - Datos iniciales del Sistema WebAR Paseo Aranjuez
 * Usuarios RBAC, locales, campañas versionadas, imágenes objetivo y contenidos.
 * Solo inicializa una base vacía; nunca elimina datos existentes.
 * ============================================================================
 */
const path = require('path')
const fs = require('fs')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

function readTargetMetadata(name) {
  const p = path.join(__dirname, '..', 'image-targets', `${name}.json`)
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch {
    return null
  }
}

function mediaSize(name) {
  const p = path.join(__dirname, '..', 'public', 'media', name)
  try {
    return fs.statSync(p).size
  } catch {
    return 1024
  }
}

async function main() {
  const counts = await Promise.all([
    prisma.evento.count(), prisma.sesion.count(), prisma.contenido.count(),
    prisma.imagenObjetivo.count(), prisma.campana.count(), prisma.local.count(),
    prisma.usuarioAdministrativo.count(),
  ])
  if (counts.some((count) => count > 0)) {
    throw new Error('Seed cancelado: la base contiene datos. No se ha eliminado ningún registro.')
  }
  const publicOrigin = process.env.PUBLIC_ORIGIN || 'http://localhost:5173'

  console.log('Insertando usuarios administrativos (RBAC)...')
  const marketing = await prisma.usuarioAdministrativo.create({
    data: { nombre: 'María Gutiérrez', cargo: 'Dirección de Marketing', rol: 'DIRECCION_MARKETING' },
  })
  const gerencia = await prisma.usuarioAdministrativo.create({
    data: { nombre: 'Carlos Rojas', cargo: 'Gerencia General', rol: 'GERENCIA' },
  })
  await prisma.usuarioAdministrativo.create({
    data: { nombre: 'Ana Beltrán', cargo: 'Community Manager', rol: 'COMMUNITY_MANAGER' },
  })

  console.log('Insertando locales comerciales...')
  const cafeAltura = await prisma.local.create({
    data: {
      nombre: 'Café Altura',
      rubro: 'Gastronomía',
      ubicacion: 'Planta baja · Local de prueba',
      whatsapp: '+591 4 4480000',
      descripcion: 'Local ficticio para pruebas académicas.',
    },
  })
  const iconic = await prisma.local.create({
    data: {
      nombre: 'iconicmodels',
      rubro: 'Gastronomía',
      ubicacion: 'piso 12',
      whatsapp: '+591 4 4480001',
      descripcion: 'Sin descripción adicional.',
    },
  })

  console.log('Insertando campañas versionadas...')

  async function createCampaign({ campaignId, version, localId, nombre, estado, fechaInicio, fechaFin, creadoPor, aprobadoPor, targetName, targetId, content }) {
    const targetMeta = readTargetMetadata(targetName) || {}
    const propertiesJson = JSON.stringify(
      targetMeta.properties || { left: 0, top: 0, width: 480, height: 640, isRotated: false, originalWidth: 480, originalHeight: 640 }
    )
    const imagePath = targetMeta.imagePath || `image-targets/${targetName}_luminance.png`
    const thumbnailPath = `image-targets/${targetName}_thumbnail.png`
    const originalPath = `image-targets/${targetName}_original.png`

    const campana = await prisma.campana.create({
      data: {
        campaignId,
        version,
        localId,
        nombre,
        estado,
        fechaInicio: new Date(fechaInicio),
        fechaFin: new Date(fechaFin),
        creadoPor,
        aprobadoPor,
      },
    })

    const objetivo = await prisma.imagenObjetivo.create({
      data: {
        targetId,
        version,
        campanaId: campana.id,
        nombreTecnico: targetName,
        imagePath,
        thumbnailPath,
        originalPath,
        propertiesJson,
        contrastScore: 86,
        qrAccessUrl: `${publicOrigin}/?campaign=${encodeURIComponent(campaignId)}`,
      },
    })

    await prisma.contenido.create({
      data: {
        campanaId: campana.id,
        imagenObjetivoId: objetivo.id,
        tipoContenido: content.tipoContenido,
        mediaUrl: content.mediaUrl,
        mediaSizeBytes: content.mediaSizeBytes,
        mediaMimeType: content.mediaMimeType,
        tituloPromocion: content.tituloPromocion,
        condicionesTexto: content.condicionesTexto,
        ctaPrimariaLabel: content.ctaPrimariaLabel || 'Ver condiciones',
        ctaSecundariaLabel: content.ctaSecundariaLabel || 'Consultar al local',
        ctaSecundariaUrl: content.ctaSecundariaUrl || 'https://www.paseoaranjuez.com/',
        overlayConfig: JSON.stringify(content.overlayConfig || null),
      },
    })

    return campana
  }

  // Café Altura - v1 (Publicada)
  await createCampaign({
    campaignId: 'camp-cafe-altura',
    version: 1,
    localId: cafeAltura.id,
    nombre: 'Una pausa para compartir',
    estado: 'PUBLICADA',
    fechaInicio: '2026-11-01',
    fechaFin: '2026-12-31',
    creadoPor: marketing.id,
    aprobadoPor: gerencia.id,
    targetName: 'cafe_altura',
    targetId: 'tgt-cafe-altura',
    content: {
      tipoContenido: 'PANEL_INFORMATIVO',
      mediaUrl: '/media/promo_cafe_altura.png',
      mediaSizeBytes: mediaSize('promo_cafe_altura.png'),
      mediaMimeType: 'image/png',
      tituloPromocion: '2 × 1 en capuchinos',
      condicionesTexto: '2 × 1 en capuchinos medianos de lunes a viernes. Campaña ficticia únicamente para pruebas de seguimiento de imágenes con 8th Wall.',
      overlayConfig: { posX: 12, posY: 10, widthPct: 76, filename: 'promo_cafe_altura.png' },
    },
  })

  // iconic models - v1, v2 (historial) y v3 (Publicada)
  await createCampaign({
    campaignId: 'camp-iconic',
    version: 1,
    localId: iconic.id,
    nombre: 'iconic models',
    estado: 'ARCHIVADA',
    fechaInicio: '2026-09-01',
    fechaFin: '2026-09-30',
    creadoPor: marketing.id,
    aprobadoPor: gerencia.id,
    targetName: 'iconic_models',
    targetId: 'tgt-iconic-models',
    content: {
      tipoContenido: 'PANEL_INFORMATIVO',
      mediaUrl: '/media/promo_iconic_models.png',
      mediaSizeBytes: mediaSize('promo_iconic_models.png'),
      mediaMimeType: 'image/png',
      tituloPromocion: 'Colección verano',
      condicionesTexto: 'Promoción sujeta a disponibilidad en el local iconicmodels de Paseo Aranjuez.',
      overlayConfig: { posX: 13, posY: 4, widthPct: 77, filename: 'promo_iconic_models.png' },
    },
  })
  await createCampaign({
    campaignId: 'camp-iconic',
    version: 2,
    localId: iconic.id,
    nombre: 'iconic models',
    estado: 'ARCHIVADA',
    fechaInicio: '2026-10-01',
    fechaFin: '2026-10-31',
    creadoPor: marketing.id,
    aprobadoPor: gerencia.id,
    targetName: 'iconic_models',
    targetId: 'tgt-iconic-models',
    content: {
      tipoContenido: 'PANEL_INFORMATIVO',
      mediaUrl: '/media/promo_iconic_models.png',
      mediaSizeBytes: mediaSize('promo_iconic_models.png'),
      mediaMimeType: 'image/png',
      tituloPromocion: 'Colección otoño',
      condicionesTexto: 'Promoción sujeta a disponibilidad en el local iconicmodels de Paseo Aranjuez.',
      overlayConfig: { posX: 13, posY: 4, widthPct: 77, filename: 'promo_iconic_models.png' },
    },
  })
  await createCampaign({
    campaignId: 'camp-iconic',
    version: 3,
    localId: iconic.id,
    nombre: 'iconic models',
    estado: 'PUBLICADA',
    fechaInicio: '2026-11-01',
    fechaFin: '2026-12-31',
    creadoPor: marketing.id,
    aprobadoPor: gerencia.id,
    targetName: 'iconic_models',
    targetId: 'tgt-iconic-models',
    content: {
      tipoContenido: 'PANEL_INFORMATIVO',
      mediaUrl: '/media/promo_iconic_models.png',
      mediaSizeBytes: mediaSize('promo_iconic_models.png'),
      mediaMimeType: 'image/png',
      tituloPromocion: 'Nueva colección',
      condicionesTexto: 'Promoción sujeta a disponibilidad en el local iconicmodels de Paseo Aranjuez.',
      overlayConfig: { posX: 13, posY: 4, widthPct: 77, filename: 'promo_iconic_models.png' },
    },
  })

  console.log('Seed completado correctamente.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
