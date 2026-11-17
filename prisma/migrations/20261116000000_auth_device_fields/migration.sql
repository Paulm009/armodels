-- Autenticación de usuarios administrativos
ALTER TABLE "usuarios_administrativos" ADD COLUMN "usuario" TEXT;
ALTER TABLE "usuarios_administrativos" ADD COLUMN "password_hash" TEXT;
CREATE UNIQUE INDEX "usuarios_administrativos_usuario_key" ON "usuarios_administrativos"("usuario");

-- Contexto técnico de la sesión
ALTER TABLE "sesiones" ADD COLUMN "user_agent" TEXT;
ALTER TABLE "sesiones" ADD COLUMN "engine_version" TEXT;
ALTER TABLE "sesiones" ADD COLUMN "app_version" TEXT;

-- Contexto técnico de cada evento
ALTER TABLE "eventos" ADD COLUMN "device_family" TEXT;
ALTER TABLE "eventos" ADD COLUMN "user_agent" TEXT;
ALTER TABLE "eventos" ADD COLUMN "engine_version" TEXT;
ALTER TABLE "eventos" ADD COLUMN "app_version" TEXT;
ALTER TABLE "eventos" ADD COLUMN "error_category" TEXT;
