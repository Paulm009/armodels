# Sistema WebAR Basado en Image Tracking para Paseo Aranjuez (8th Wall)

Implementación funcional completa del Proyecto de Grado **"Sistema WebAR basado en Image Tracking para la promoción interactiva de los locales comerciales de Paseo Aranjuez"** (Nicolette Chalup, Carrera de Ingeniería de Sistemas, Universidad Católica Boliviana "San Pablo", Cochabamba – Bolivia).

Stack: **React + Vite** (frontend), **Express** (backend REST), **Prisma + SQLite con migraciones** (persistencia) y **8th Wall** (motor WebAR open-source de Image Tracking).

## Estructura

- `prisma/schema.prisma`: modelo de datos (7 entidades de la Tabla 2.5) con `UsuariosAdministrativo`, `Local`, `Campana` (versionada), `ImagenObjetivo` (versionada), `Contenido`, `Sesion` y `Evento` (deduplicación por `event_id`).
- `prisma/migrations/`: migraciones SQL generadas por Prisma Migrate.
- `prisma/seed.js`: datos iniciales (usuarios RBAC, locales, campañas versionadas, objetivos y contenidos).
- `src/server/core-service.js`: servicio de aplicación con control de acceso RBAC (OWASP), validación de archivos por firma binaria, gestión de vigencias y cálculo de los 7 indicadores operativos (Tabla 2.7).
- `src/server/app.js`: API REST (público + administración + telemetría `sendBeacon`), sirve estáticos (`/image-targets`, `/media`, build del frontend).
- `client/`: aplicación React + Vite (vistas: Vista general, Campañas, Locales, Reportes, Cómo probar) y el modal de experiencia WebAR.
- `client/src/webar/WebARController.js`: integración con el motor 8th Wall (`XrController.configure({ disableWorldTracking: true, imageTargetData })`, `addCameraPipelineModules`, `XR8.run`/`XR8.stop`, máquina de estados de 6 etapas, jerarquía Three.js, control de video, `Page Visibility API` y envío de telemetría).
- `scripts/generate-image-targets.mjs`: genera afiches de alto contraste y los image targets reales (metadata JSON + luminancia 480×640 + miniatura 263×350) con `@8thwall/image-target-cli`.
- `tests/istqb-validation.test.js`: suite de 8 pruebas ISTQB (Sección 2.11) sobre una base de datos de prueba.

## Requisitos

- Node.js ≥ 18 (probado con Node 22).

## Puesta en marcha

```bash
npm install            # instala dependencias
npm run db:migrate     # aplica migraciones y genera el cliente Prisma
npm run db:seed        # carga datos de demostración
npm run prepare-targets # genera los image targets 8th Wall y los medios promocionales
npm run dev            # levanta API (3000) + frontend Vite (5173)
```

Abre http://localhost:5173. El frontend de desarrollo proxy-iza `/api`, `/image-targets` y `/media` al backend en `:3000`.

### Acceso desde el celular (misma red Wi-Fi)

Vite escucha en `0.0.0.0` (`host: true`) y Express en `0.0.0.0`, por lo que puedes abrir el sistema desde tu celular usando la IP de tu PC:

```text
http://<IP-DE-TU-PC>:5173
```

La IP aparece al iniciar `npm run dev` (línea `Network:` de Vite). Si no carga, permite el acceso a Node en el Firewall de Windows (perfiles Privado/Público) y confirma que el celular esté en la misma red Wi-Fi.

## Producción

```bash
npm run build          # compila el frontend a client/dist
npm start              # Express sirve API + estáticos + SPA en http://localhost:3000
```

## Base de datos y migraciones

Prisma + SQLite (definido en `.env` con `DATABASE_URL`). Migraciones:

```bash
npm run db:migrate   # crea/aplica migraciones (prisma migrate dev)
npm run db:deploy    # aplica migraciones existentes (prisma migrate deploy)
```

## 8th Wall

- Sin configurar `VITE_8THWALL_APP_KEY`, el motor open-source (`@8thwall/engine`) se carga desde CDN con Image Targets (sin SLAM, sin cuenta).
- Si defines `VITE_8THWALL_APP_KEY` en `.env`, se carga el motor en la nube de 8th Wall (`https://apps.8thwall.com/xrweb?appKey=…`) con SLAM + Image Targets alojados en tu workspace.

Para móvil, la cámara requiere HTTPS (usa un túnel tipo ngrok) o localhost.

## Pruebas

```bash
npm test
```
