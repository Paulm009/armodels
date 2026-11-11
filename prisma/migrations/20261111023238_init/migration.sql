-- CreateTable
CREATE TABLE "usuarios_administrativos" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nombre" TEXT NOT NULL,
    "cargo" TEXT NOT NULL,
    "rol" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "locales" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nombre" TEXT NOT NULL,
    "rubro" TEXT NOT NULL,
    "ubicacion_mall" TEXT NOT NULL,
    "contacto_whatsapp" TEXT NOT NULL,
    "descripcion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "campanas" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "campaign_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "local_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "fecha_inicio" DATETIME NOT NULL,
    "fecha_fin" DATETIME NOT NULL,
    "creado_por" TEXT,
    "aprobado_por" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "campanas_local_id_fkey" FOREIGN KEY ("local_id") REFERENCES "locales" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "imagenes_objetivo" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "target_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "campana_id" INTEGER NOT NULL,
    "nombre_tecnico" TEXT NOT NULL,
    "image_path" TEXT NOT NULL,
    "thumbnail_path" TEXT NOT NULL,
    "original_path" TEXT NOT NULL,
    "properties_json" TEXT NOT NULL,
    "contrast_score" REAL NOT NULL,
    "qr_access_url" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "imagenes_objetivo_campana_id_fkey" FOREIGN KEY ("campana_id") REFERENCES "campanas" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "contenidos" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "campana_id" INTEGER NOT NULL,
    "imagen_objetivo_id" INTEGER NOT NULL,
    "tipo_contenido" TEXT NOT NULL,
    "media_url" TEXT NOT NULL,
    "media_size_bytes" INTEGER NOT NULL,
    "media_mime_type" TEXT NOT NULL,
    "titulo_promocion" TEXT NOT NULL,
    "condiciones_texto" TEXT NOT NULL,
    "cta_primaria_label" TEXT NOT NULL DEFAULT 'Ver condiciones',
    "cta_secundaria_label" TEXT NOT NULL DEFAULT 'Consultar al local',
    "cta_secundaria_url" TEXT NOT NULL,
    "overlay_config" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contenidos_campana_id_fkey" FOREIGN KEY ("campana_id") REFERENCES "campanas" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "contenidos_imagen_objetivo_id_fkey" FOREIGN KEY ("imagen_objetivo_id") REFERENCES "imagenes_objetivo" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sesiones" (
    "session_id" TEXT NOT NULL PRIMARY KEY,
    "campaign_id" TEXT NOT NULL,
    "campaign_version" INTEGER NOT NULL,
    "access_mechanism" TEXT NOT NULL,
    "device_family" TEXT NOT NULL,
    "camera_ready" BOOLEAN NOT NULL DEFAULT false,
    "scanning_started" BOOLEAN NOT NULL DEFAULT false,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" DATETIME
);

-- CreateTable
CREATE TABLE "eventos" (
    "event_id" TEXT NOT NULL PRIMARY KEY,
    "session_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "campaign_version" INTEGER NOT NULL,
    "target_id" TEXT,
    "target_version" INTEGER,
    "event_type" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "client_time" DATETIME NOT NULL,
    "received_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "schema_version" TEXT NOT NULL DEFAULT '1.0.0',
    CONSTRAINT "eventos_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sesiones" ("session_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "locales_nombre_key" ON "locales"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "campanas_campaign_id_version_key" ON "campanas"("campaign_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "imagenes_objetivo_target_id_version_key" ON "imagenes_objetivo"("target_id", "version");

-- CreateIndex
CREATE INDEX "sesiones_campaign_id_campaign_version_idx" ON "sesiones"("campaign_id", "campaign_version");

-- CreateIndex
CREATE INDEX "eventos_campaign_id_campaign_version_event_type_idx" ON "eventos"("campaign_id", "campaign_version", "event_type");

-- CreateIndex
CREATE INDEX "eventos_session_id_event_type_idx" ON "eventos"("session_id", "event_type");
