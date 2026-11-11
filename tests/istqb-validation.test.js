/**
 * ============================================================================
 * SUITE DE VERIFICACIÓN Y VALIDACIÓN DEL SISTEMA (OE7 - Sección 2.11 ISTQB)
 * Pruebas unitarias, de integración y de reglas de reportes sobre el backend
 * real (Prisma + SQLite en una base de datos de prueba con migraciones).
 * ============================================================================
 */
const assert = require('assert')
const { execSync } = require('child_process')
const { PaseoAranjuezCoreService } = require('../src/server/core-service')
const { newPrismaClient } = require('../src/server/db')
const { build8thWallTargetMetadata } = require('../scripts/prepare-image-targets')

const TEST_DATABASE_URL = 'file:./test.db'

function prepareTestDatabase() {
  // Aplica las migraciones a una base de datos SQLite de prueba aislada.
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'ignore',
    cwd: require('path').resolve(__dirname, '..'),
  })
  return newPrismaClient(TEST_DATABASE_URL)
}

async function resetDatabase(prisma) {
  await prisma.evento.deleteMany()
  await prisma.sesion.deleteMany()
  await prisma.contenido.deleteMany()
  await prisma.imagenObjetivo.deleteMany()
  await prisma.campana.deleteMany()
  await prisma.local.deleteMany()
  await prisma.usuarioAdministrativo.deleteMany()
}

async function runValidationSuite() {
  const prisma = prepareTestDatabase()
  await resetDatabase(prisma)
  const service = new PaseoAranjuezCoreService(prisma)

  const results = []
  const recordTest = (id, name, fn) => {
    return Promise.resolve()
      .then(fn)
      .then(() => {
        results.push({ id, name, status: 'PASSED' })
        console.log(`[PASS] ${id} - ${name}`)
      })
      .catch((err) => {
        results.push({ id, name, status: 'FAILED', error: err.message })
        console.error(`[FAIL] ${id} - ${name}: ${err.message}`)
        process.exitCode = 1
      })
  }

  // Preparación de local comercial de prueba en Paseo Aranjuez
  const local = await service.registerLocal(
    {
      nombre: 'Terraza Aranjuez Bistro & Café',
      rubro: 'Gastronomía',
      ubicacion: 'Nivel 3 - Mercado Gastronómico',
      contacto_whatsapp: '+591 4 4480000',
    },
    'DIRECCION_MARKETING'
  )
  const localId = local.id

  // PRUEBA 1 (Sección 2.11.1): Rechazo de publicación de campaña vencida
  await recordTest('TC-01', 'Impedir publicación de campaña con fecha de vigencia vencida (Sección 2.11.1)', async () => {
    await assert.rejects(
      () =>
        service.saveCampaign(
          {
            campaign_id: 'CMP-VENCIDA',
            local_id: localId,
            nombre: 'Promo Invierno Pasado',
            estado: 'PUBLICADA',
            fecha_inicio: '2026-06-01',
            fecha_fin: '2026-06-30',
            target: { target_id: 'TGT-01', nombre_tecnico: 'afiche-invierno', image_path: 'img.png', properties: {} },
            content: { media_url: 'video.mp4', condiciones_texto: '2x1 en cafés' },
          },
          'DIRECCION_MARKETING',
          '2026-11-10'
        ),
      /vencido/i
    )
  })

  // PRUEBA 2 (Sección 2.6.5): Consistencia transaccional al publicar sin objetivo o sin contenido
  await recordTest('TC-02', 'Rechazar publicación de campaña incompleta sin Imagen Objetivo o Contenido (Sección 2.6.5)', async () => {
    await assert.rejects(
      () =>
        service.saveCampaign(
          {
            campaign_id: 'CMP-INCOMPLETA',
            local_id: localId,
            nombre: 'Promo sin Objetivo',
            estado: 'PUBLICADA',
            fecha_inicio: '2026-11-01',
            fecha_fin: '2026-12-15',
            target: null,
            content: { media_url: 'video.mp4', condiciones_texto: 'Condiciones' },
          },
          'DIRECCION_MARKETING',
          '2026-11-10'
        ),
      /Imagen Objetivo/i
    )
  })

  // PRUEBA 3 (Sección 2.10.1 OWASP): Control de acceso RBAC por rol
  await recordTest('TC-03', 'Denegar modificación administrativa a roles no autorizados (OWASP Sección 2.10.1)', async () => {
    await assert.rejects(
      () =>
        service.saveCampaign(
          {
            campaign_id: 'CMP-NO-AUTH',
            local_id: localId,
            nombre: 'Intento Visitante',
            estado: 'EN_PREPARACION',
            fecha_inicio: '2026-11-01',
            fecha_fin: '2026-12-01',
          },
          'VISITANTE_PUBLICO',
          '2026-11-10'
        ),
      /Acceso denegado \(403\)/
    )
  })

  // PRUEBA 4 (Sección 2.10.2 OWASP): Validación de firma binaria y metadatos Image Target
  await recordTest('TC-04', 'Validar firma binaria de imagen y estructura de metadata 8th Wall (Sección 2.5.4 y 2.10.2)', () => {
    assert.throws(() => {
      service.validateUploadedAsset({
        filename: 'falso_poster.png',
        mimeType: 'image/png',
        sizeBytes: 120000,
        magicBytes: [0xff, 0xd8, 0xff, 0xe0], // Cabecera JPEG en archivo declarado como PNG
        width: 960,
        height: 1280,
        contrastScore: 78,
      })
    }, /firma binaria/i)

    const metadata = build8thWallTargetMetadata({
      targetId: 'TGT-ARANJUEZ-01',
      targetName: 'afiche_gastronomico_v1',
    })
    assert.ok(metadata.imagePath.endsWith('afiche_gastronomico_v1_luminance.png'))
    assert.strictEqual(metadata.type, 'PLANAR')
    assert.strictEqual(metadata.name, 'afiche_gastronomico_v1')
  })

  // PRUEBA 5 (Sección 2.11.3): Deduplicación idempotente de eventos
  await recordTest('TC-05', 'Deduplicación idempotente de 5 identificadores de evento enviados dos veces (Sección 2.11.3)', async () => {
    await service.saveCampaign(
      {
        campaign_id: 'CMP-ACTIVA-01',
        local_id: localId,
        nombre: 'Festival Gastronómico Aranjuez 2x1',
        estado: 'PUBLICADA',
        fecha_inicio: '2026-11-01',
        fecha_fin: '2026-12-31',
        target: { target_id: 'TGT-01', nombre_tecnico: 'afiche-gastro-01', image_path: 'l.png', properties: { width: 480, height: 640 } },
        content: { media_url: 'spot.mp4', condiciones_texto: 'Válido de lunes a jueves de 18:00 a 21:00.' },
      },
      'DIRECCION_MARKETING',
      '2026-11-10'
    )

    const fiveEvents = [
      { event_id: 'EVT-101', session_id: 'SES-01', campaign_id: 'CMP-ACTIVA-01', campaign_version: 1, event_type: 'SESSION_OPEN', client_time: '2026-11-10T19:00:00Z' },
      { event_id: 'EVT-102', session_id: 'SES-01', campaign_id: 'CMP-ACTIVA-01', campaign_version: 1, event_type: 'CAMERA_READY', client_time: '2026-11-10T19:00:01Z' },
      { event_id: 'EVT-103', session_id: 'SES-01', campaign_id: 'CMP-ACTIVA-01', campaign_version: 1, event_type: 'TARGET_FOUND', payload: { timeToRecognitionMs: 1420 }, client_time: '2026-11-10T19:00:02Z' },
      { event_id: 'EVT-104', session_id: 'SES-01', campaign_id: 'CMP-ACTIVA-01', campaign_version: 1, event_type: 'CONTENT_VIEWED', client_time: '2026-11-10T19:00:03Z' },
      { event_id: 'EVT-105', session_id: 'SES-01', campaign_id: 'CMP-ACTIVA-01', campaign_version: 1, event_type: 'CTA_CLICK', payload: { ctaType: 'VER_CONDICIONES' }, client_time: '2026-11-10T19:00:10Z' },
    ]

    for (const ev of fiveEvents) await service.ingestEvent(ev)
    for (const ev of fiveEvents) await service.ingestEvent(ev) // reintento

    const report = await service.computeCampaignMetrics('CMP-ACTIVA-01', 1)
    assert.strictEqual(report.uniqueEventsCount, 5, 'El total debe conservar exactamente 5 eventos únicos')
    assert.strictEqual(report.indicators.sesionesConReconocimiento.value, 1)
    assert.strictEqual(report.indicators.tasaReconocimientoPorSesion.value, 100)
    assert.strictEqual(report.indicators.sesionesConCTA.value, 100)
  })

  // PRUEBA 6 (Sección 2.8.3 y 2.11.3): Exclusión de intervalos sin imagen seguida o pestaña oculta
  await recordTest('TC-06', 'Excluir tramos con imagen perdida o pestaña oculta del tiempo de seguimiento visible (Sección 2.8.3)', async () => {
    await service.ingestEvent({ event_id: 'EVT-106', session_id: 'SES-01', campaign_id: 'CMP-ACTIVA-01', campaign_version: 1, event_type: 'TRACKING_INTERVAL_CLOSED', payload: { intervalMs: 10000, isTracked: true, isVisible: true, reason: 'IMAGE_LOST' }, client_time: '2026-11-10T19:00:12Z' })
    await service.ingestEvent({ event_id: 'EVT-107', session_id: 'SES-01', campaign_id: 'CMP-ACTIVA-01', campaign_version: 1, event_type: 'TRACKING_INTERVAL_CLOSED', payload: { intervalMs: 15000, isTracked: false, isVisible: true, reason: 'UNTRACKED_GAP' }, client_time: '2026-11-10T19:00:27Z' })
    await service.ingestEvent({ event_id: 'EVT-108', session_id: 'SES-01', campaign_id: 'CMP-ACTIVA-01', campaign_version: 1, event_type: 'TRACKING_INTERVAL_CLOSED', payload: { intervalMs: 8000, isTracked: true, isVisible: true, reason: 'SESSION_STOP' }, client_time: '2026-11-10T19:00:35Z' })

    const report = await service.computeCampaignMetrics('CMP-ACTIVA-01', 1)
    assert.strictEqual(report.indicators.seguimientoVisibleSegundos.valueMs, 18000, '10s + 8s = 18s exactos de seguimiento visible')
    assert.strictEqual(report.indicators.seguimientoVisibleSegundos.valueSec, 18)
  })

  // PRUEBA 7 (Sección 2.6.4 y 2.8.5): Preservación de versión histórica y 'No calculable (N/C)'
  await recordTest('TC-07', 'Conservar versión histórica en reportes y mostrar No calculable (N/C) con denominador cero (Sección 2.6.4 y 2.8.5)', async () => {
    const v2 = await service.saveCampaign(
      {
        campaign_id: 'CMP-ACTIVA-01',
        local_id: localId,
        nombre: 'Festival Gastronómico Aranjuez 2x1 - Edición Actualizada',
        estado: 'PUBLICADA',
        fecha_inicio: '2026-11-01',
        fecha_fin: '2026-12-31',
        target: { target_id: 'TGT-01', nombre_tecnico: 'afiche-gastro-01', image_path: 'l.png', properties: { width: 480, height: 640 } },
        content: { media_url: 'spot_v2.mp4', condiciones_texto: 'Nuevas condiciones extendidas hasta las 22:00.' },
      },
      'DIRECCION_MARKETING',
      '2026-11-10'
    )

    assert.strictEqual(v2.version, 2)
    const reportV1 = await service.computeCampaignMetrics('CMP-ACTIVA-01', 1)
    const reportV2 = await service.computeCampaignMetrics('CMP-ACTIVA-01', 2)

    assert.strictEqual(reportV1.indicators.sesionesConReconocimiento.value, 1, 'La versión 1 conserva intactas sus métricas históricas')
    assert.strictEqual(reportV2.indicators.tasaReconocimientoPorSesion.formatted, 'No calculable (N/C)', 'Sin sesiones elegibles en v2 debe reportar No calculable (N/C) y no 0%')
  })

  // PRUEBA 8 (Sección 2.6.6 y 2.11.2): Campaña vencida consultada por visitante
  await recordTest('TC-08', 'Mostrar aviso de finalización sin reproducir oferta caducada cuando la campaña ha vencido (Sección 2.6.6)', async () => {
    const visitorLookup = await service.getActiveCampaignForVisitor('CMP-ACTIVA-01', '2027-02-01')
    assert.strictEqual(visitorLookup.status, 'EXPIRED')
    assert.strictEqual(visitorLookup.showPromotionalMedia, false)
  })

  await prisma.$disconnect()
  console.log(`\nResumen ISTQB: ${results.filter((r) => r.status === 'PASSED').length}/${results.length} pruebas superadas.`)
}

runValidationSuite().catch((err) => {
  console.error(err)
  process.exit(1)
})
