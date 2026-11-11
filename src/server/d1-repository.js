const { formatMetricReport } = require('./core-service')

// Todas las entradas del cliente se pasan como parámetros, nunca como SQL.
function fromRow(row) {
  if (!row) return null
  const value = Object.fromEntries(Object.entries(row).map(([key, val]) => [
    key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()), val,
  ]))
  for (const key of ['createdAt', 'fechaInicio', 'fechaFin', 'clientTime', 'receivedAt']) {
    if (value[key] != null) value[key] = new Date(value[key])
  }
  if ('activo' in value) value.activo = Boolean(value.activo)
  if ('ubicacionMall' in value) {
    value.ubicacion = value.ubicacionMall
    value.whatsapp = value.contactoWhatsapp
    delete value.ubicacionMall
    delete value.contactoWhatsapp
  }
  return value
}

function httpError(message, statusCode) {
  return Object.assign(new Error(message), { statusCode })
}

// La agregación ocurre en SQLite: no descargamos todo el historial de eventos
// al Worker y el número de consultas de reportes no crece con las campañas.
function metricsSQL(where = '', grouped = false) {
  return `WITH ranked AS (
    SELECT *, ROW_NUMBER() OVER (
      PARTITION BY campaign_id, campaign_version, session_id, event_type
      ORDER BY client_time, event_id
    ) AS event_rank FROM eventos ${where}
  ), session_summary AS (
    SELECT campaign_id, campaign_version, session_id,
      COUNT(*) AS event_count,
      MAX(event_type IN ('CAMERA_READY', 'SCANNING_STARTED')) AS camera,
      MAX(event_type = 'TARGET_FOUND') AS recognized,
      MAX(event_type = 'CONTENT_VIEWED') AS content,
      MAX(event_type = 'CTA_CLICK') AS cta,
      MAX(event_type = 'SESSION_ERROR') AS error,
      SUM(event_type = 'TARGET_LOST') AS losses,
      SUM(CASE WHEN event_type = 'TRACKING_INTERVAL_CLOSED'
        AND COALESCE(json_extract(payload, '$.isTracked'), 1) != 0
        AND COALESCE(json_extract(payload, '$.isVisible'), 1) != 0
        THEN COALESCE(json_extract(payload, '$.intervalMs'), 0) ELSE 0 END) AS visible_ms,
      MAX(CASE WHEN event_type = 'TARGET_FOUND' AND event_rank = 1
        AND json_type(payload, '$.timeToRecognitionMs') IN ('integer', 'real')
        THEN json_extract(payload, '$.timeToRecognitionMs') END) AS latency
    FROM ranked GROUP BY campaign_id, campaign_version, session_id
  ) SELECT ${grouped ? 'campaign_id, campaign_version,' : ''}
    COUNT(*) AS totalSessionsInitiated,
    COALESCE(SUM(event_count), 0) AS uniqueEventsCount,
    COALESCE(SUM(camera), 0) AS sessionsWithCameraAndScan,
    COALESCE(SUM(recognized), 0) AS sessionsWithRecognition,
    COALESCE(SUM(content), 0) AS sessionsWithContentShown,
    COALESCE(SUM(cta), 0) AS sessionsWithCtaClick,
    COALESCE(SUM(error), 0) AS sessionsWithError,
    COALESCE(SUM(losses), 0) AS totalLosses,
    COALESCE(SUM(visible_ms), 0) AS totalVisibleTrackingMs,
    AVG(latency) AS avgLatencyMs, COUNT(latency) AS latencySamples
    FROM session_summary ${grouped ? 'GROUP BY campaign_id, campaign_version' : ''}`
}

function metricReport(campaignId, version, stats) {
  return formatMetricReport(campaignId, version, {
    ...stats,
    avgLatencyMs: stats.avgLatencyMs == null ? null : Math.round(stats.avgLatencyMs),
  })
}

class D1Repository {
  constructor(db) {
    this.db = db
  }

  statement(sql, ...params) {
    return params.length ? this.db.prepare(sql).bind(...params) : this.db.prepare(sql)
  }

  async getLocal(id) {
    return fromRow(await this.statement('SELECT * FROM locales WHERE id = ?', id).first())
  }

  async createLocal(local) {
    const id = crypto.randomUUID()
    const row = await this.statement(`INSERT INTO locales
      (id, nombre, rubro, ubicacion_mall, contacto_whatsapp, descripcion, activo)
      VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    id, local.nombre, local.rubro, local.ubicacion, local.whatsapp, local.descripcion, Number(local.activo)).first()
    return fromRow(row)
  }

  async listLocales() {
    const { results } = await this.statement(`SELECT l.*,
      (SELECT COUNT(*) FROM campanas c WHERE c.local_id = l.id) AS campanas_count
      FROM locales l ORDER BY l.nombre`).all()
    return results.map(fromRow)
  }

  async updateLocal(id, data) {
    const columns = { nombre: 'nombre', rubro: 'rubro', ubicacion: 'ubicacion_mall', whatsapp: 'contacto_whatsapp', descripcion: 'descripcion' }
    const entries = Object.entries(data).filter(([key, value]) => key in columns && value !== undefined)
    if (!entries.length) {
      const local = await this.getLocal(id)
      if (!local) throw httpError('Local no encontrado.', 404)
      return local
    }
    const row = await this.statement(`UPDATE locales SET
      ${entries.map(([key]) => `${columns[key]} = ?`).join(', ')} WHERE id = ? RETURNING *`,
    ...entries.map(([, value]) => value), id).first()
    if (!row) throw httpError('Local no encontrado.', 404)
    return fromRow(row)
  }

  async listCampaigns({ campaignId = null, version = null, latestOnly = false } = {}) {
    const conditions = []
    const params = []
    if (campaignId !== null) { conditions.push('c.campaign_id = ?'); params.push(campaignId) }
    if (version !== null) { conditions.push('c.version = ?'); params.push(version) }
    if (latestOnly) conditions.push('c.version = (SELECT MAX(v.version) FROM campanas v WHERE v.campaign_id = c.campaign_id)')
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const [campaigns, targets, contents] = await this.db.batch([
      this.statement(`SELECT c.*, l.nombre AS local_nombre, l.rubro AS local_rubro,
        l.ubicacion_mall AS local_ubicacion FROM campanas c JOIN locales l ON l.id = c.local_id
        ${where} ORDER BY c.campaign_id, c.version DESC`, ...params),
      this.statement(`SELECT t.* FROM imagenes_objetivo t JOIN campanas c ON c.id = t.campana_id ${where} ORDER BY t.id`, ...params),
      this.statement(`SELECT t.* FROM contenidos t JOIN campanas c ON c.id = t.campana_id ${where} ORDER BY t.id`, ...params),
    ])
    const byCampaign = (rows) => {
      const map = new Map()
      for (const row of rows) {
        if (!map.has(row.campana_id)) map.set(row.campana_id, [])
        map.get(row.campana_id).push(fromRow(row))
      }
      return map
    }
    const images = byCampaign(targets.results)
    const media = byCampaign(contents.results)
    return campaigns.results.map((row) => ({
      ...fromRow(row),
      local: { id: row.local_id, nombre: row.local_nombre, rubro: row.local_rubro, ubicacion: row.local_ubicacion },
      imagenes: images.get(row.id) || [], contenidos: media.get(row.id) || [],
    }))
  }

  async saveCampaign({ campaign: c, target: t, content: m }) {
    // MAX(version) + 1 se calcula dentro de la misma transacción que las tres
    // inserciones. Publicaciones concurrentes no pueden reutilizar una versión.
    const current = '(SELECT id FROM campanas WHERE campaign_id = ? ORDER BY version DESC LIMIT 1)'
    const [saved] = await this.db.batch([
      this.statement(`INSERT INTO campanas
        (campaign_id, version, local_id, nombre, estado, fecha_inicio, fecha_fin, creado_por, aprobado_por)
        SELECT ?, COALESCE(MAX(version), 0) + 1, ?, ?, ?, ?, ?, ?, ?
        FROM campanas WHERE campaign_id = ? RETURNING *`,
      c.campaignId, c.localId, c.nombre, c.estado, c.fechaInicio.getTime(), c.fechaFin.getTime(), c.creadoPor, c.aprobadoPor, c.campaignId),
      this.statement(`INSERT INTO imagenes_objetivo
        (target_id, version, campana_id, nombre_tecnico, image_path, thumbnail_path,
         original_path, properties_json, contrast_score, qr_access_url)
        SELECT ?, version, id, ?, ?, ?, ?, ?, ?, ? FROM campanas WHERE id = ${current}`,
      t.targetId, t.nombreTecnico, t.imagePath, t.thumbnailPath, t.originalPath, t.propertiesJson, t.contrastScore, t.qrAccessUrl, c.campaignId),
      this.statement(`INSERT INTO contenidos
        (campana_id, imagen_objetivo_id, tipo_contenido, media_url, media_size_bytes,
         media_mime_type, titulo_promocion, condiciones_texto, cta_primaria_label,
         cta_secundaria_label, cta_secundaria_url, overlay_config)
        SELECT campana_id, id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        FROM imagenes_objetivo WHERE campana_id = ${current}`,
      m.tipoContenido, m.mediaUrl, m.mediaSizeBytes, m.mediaMimeType, m.tituloPromocion,
      m.condicionesTexto, m.ctaPrimariaLabel, m.ctaSecundariaLabel, m.ctaSecundariaUrl, m.overlayConfig, c.campaignId),
    ])
    const [campaign] = await this.listCampaigns({ campaignId: c.campaignId, version: saved.results[0].version })
    return campaign
  }

  async ingestEvent({ session: s, event: e }) {
    const results = await this.db.batch([
      this.statement(`INSERT INTO sesiones
        (session_id, campaign_id, campaign_version, access_mechanism, device_family,
         camera_ready, scanning_started, started_at, ended_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM eventos WHERE event_id = ?)
        AND EXISTS (SELECT 1 FROM campanas WHERE campaign_id = ? AND version = ?)
        ON CONFLICT(session_id) DO UPDATE SET
          camera_ready = MAX(sesiones.camera_ready, excluded.camera_ready),
          scanning_started = MAX(sesiones.scanning_started, excluded.scanning_started),
          ended_at = COALESCE(sesiones.ended_at, excluded.ended_at)
        WHERE sesiones.campaign_id = excluded.campaign_id
          AND sesiones.campaign_version = excluded.campaign_version`,
      s.sessionId, s.campaignId, s.campaignVersion, s.accessMechanism, s.deviceFamily,
      Number(s.cameraReady), Number(s.scanningStarted), s.startedAt.getTime(),
      e.eventType === 'SESSION_CLOSE' ? e.clientTime.getTime() : null, e.eventId, s.campaignId, s.campaignVersion),
      this.statement(`INSERT INTO eventos
        (event_id, session_id, campaign_id, campaign_version, target_id, target_version,
         event_type, payload, client_time, schema_version)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM sesiones WHERE session_id = ? AND campaign_id = ? AND campaign_version = ?)
        ON CONFLICT(event_id) DO NOTHING`,
      e.eventId, e.sessionId, e.campaignId, e.campaignVersion, e.targetId, e.targetVersion,
      e.eventType, e.payload, e.clientTime.getTime(), e.schemaVersion, s.sessionId, s.campaignId, s.campaignVersion),
      this.statement('SELECT * FROM eventos WHERE event_id = ?', e.eventId),
    ])
    const row = results[2].results[0]
    if (!row) throw httpError('La campaña no existe o la sesión pertenece a otra campaña o versión.', 400)
    return { deduplicated: results[1].meta.changes === 0, event: fromRow(row) }
  }

  async computeCampaignMetrics(campaignId, version = null) {
    const where = `WHERE campaign_id = ?${version === null ? '' : ' AND campaign_version = ?'}`
    const params = version === null ? [campaignId] : [campaignId, version]
    const stats = await this.statement(metricsSQL(where), ...params).first()
    return metricReport(campaignId, version, stats)
  }

  async listReportData() {
    const [campaigns, stats] = await this.db.batch([
      this.statement('SELECT campaign_id, version, nombre, estado FROM campanas ORDER BY campaign_id, version DESC'),
      this.statement(metricsSQL('', true)),
    ])
    return {
      campaigns: campaigns.results.map(fromRow),
      metrics: new Map(stats.results.map((row) => [
        `${row.campaign_id}:${row.campaign_version}`, metricReport(row.campaign_id, row.campaign_version, row),
      ])),
    }
  }
}

module.exports = { D1Repository }
