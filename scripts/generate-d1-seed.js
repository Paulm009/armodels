/**
 * ============================================================================
 * SEED - Datos iniciales del Sistema WebAR Paseo Aranjuez
 * Usuarios RBAC, locales, campañas versionadas, imágenes objetivo y contenidos.
 * Genera SQL determinista para la migración D1 de demostración.
 * No se conecta a ninguna base ni elimina datos.
 * ============================================================================
 */
const path = require('path')
const fs = require('fs')
const statements = []
const counters = {}
const tables = {
  usuarioAdministrativo: 'usuarios_administrativos', local: 'locales',
  campana: 'campanas', imagenObjetivo: 'imagenes_objetivo', contenido: 'contenidos',
}
const sqlLiteral = (value) => {
  if (value == null) return 'NULL'
  if (value instanceof Date) return String(value.getTime())
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? '1' : '0'
  return `'${String(value).replace(/'/g, "''")}'`
}
const column = (key) => ({ ubicacion: 'ubicacion_mall', whatsapp: 'contacto_whatsapp' }[key]
  || key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`))
const seed = Object.fromEntries(Object.entries(tables).map(([model, table]) => [model, {
  create({ data }) {
    counters[table] = (counters[table] || 0) + 1
    const id = ['locales', 'usuarios_administrativos'].includes(table)
      ? `demo-${table}-${counters[table]}` : counters[table]
    const row = { id, ...data }
    statements.push(`INSERT INTO ${table} (${Object.keys(row).map(column).join(', ')}) VALUES (${Object.values(row).map(sqlLiteral).join(', ')});`)
    return row
  },
}]))

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
  console.log('Insertando usuarios administrativos (RBAC)...')
  const marketing = await seed.usuarioAdministrativo.create({
    data: { nombre: 'María Gutiérrez', cargo: 'Dirección de Marketing', rol: 'DIRECCION_MARKETING' },
  })
  const gerencia = await seed.usuarioAdministrativo.create({
    data: { nombre: 'Carlos Rojas', cargo: 'Gerencia General', rol: 'GERENCIA' },
  })
  await seed.usuarioAdministrativo.create({
    data: { nombre: 'Ana Beltrán', cargo: 'Community Manager', rol: 'COMMUNITY_MANAGER' },
  })

  console.log('Insertando locales comerciales...')
  const cafeAltura = await seed.local.create({
    data: {
      nombre: 'Café Altura',
      rubro: 'Gastronomía',
      ubicacion: 'Planta baja · Local de prueba',
      whatsapp: '+591 4 4480000',
      descripcion: 'Local ficticio para pruebas académicas.',
    },
  })
  const iconic = await seed.local.create({
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

    const campana = await seed.campana.create({
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

    const objetivo = await seed.imagenObjetivo.create({
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
        qrAccessUrl: `/?campaign=${campaignId}`,
      },
    })

    await seed.contenido.create({
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

  const output = path.join(__dirname, '..', 'migrations', '0002_demo_data.sql')
  fs.writeFileSync(output, '-- Datos de demostración. Wrangler aplica esta migración una sola vez.\n'
    + statements.join('\n') + '\n')
  console.log('Migración de demostración generada correctamente.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
