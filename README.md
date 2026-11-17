# Sistema WebAR Basado en Image Tracking para Paseo Aranjuez (8th Wall)

Implementación funcional del Proyecto de Grado **"Sistema WebAR basado en Image Tracking para la promoción interactiva de los locales comerciales de Paseo Aranjuez"** (Nicolette Chalup, Carrera de Ingeniería de Sistemas, Universidad Católica Boliviana "San Pablo", Cochabamba – Bolivia).

Stack: **React + Vite** (frontend), **Express** (backend REST), **Prisma + SQLite con migraciones** (persistencia) y **8th Wall** (motor WebAR open-source de Image Tracking).

## Estructura

- `prisma/schema.prisma`: modelo de datos (7 entidades de la Tabla 2.5) con usuarios administrativos autenticados, locales, campañas versionadas, imágenes objetivo versionadas, contenidos, sesiones y eventos deduplicados.
- `prisma/migrations/`: migraciones SQL generadas por Prisma Migrate.
- `prisma/seed.js`: datos iniciales (usuarios con contraseña, locales, campañas versionadas, objetivos y contenidos).
- `src/server/auth.js`: autenticación con scrypt y tokens HMAC; autorización por rol.
- `src/server/core-service.js`: reglas de campañas, validación de archivos, image targets, telemetría y los 7 indicadores operativos (Tabla 2.7).
- `src/server/app.js`: API REST (pública, autenticación, administración y telemetría), QR público, rate limiting y cabeceras de seguridad.
- `client/src/webar/capabilities.js`: detección de HTTPS, WebGL, WebAssembly SIMD, versión de iOS y navegador embebido.
- `client/src/webar/loadEngine.js`: carga reintentable del motor y del chunk de Image Tracking.
- `client/src/webar/WebARController.js`: ciclo de vida del motor, cámara trasera, contenido por target, video compatible con iOS y telemetría.
- `client/src/components/WebARModal.jsx`: experiencia AR, errores específicos y consulta alternativa sin cámara.
- `client/src/components/PublicExperience.jsx`: experiencia pública en `/ar/:campaignId` para enlaces y QR.
- `scripts/generate-image-targets.mjs`: genera afiches de alto contraste y los image targets (metadata JSON + luminancia 480×640 + miniatura 263×350).
- `tests/istqb-validation.test.js`: suite ISTQB (Sección 2.11) sobre una base de datos de prueba.

## Requisitos

- Node.js ≥ 18 (probado con Node 22).
- Para probar en un teléfono: **HTTPS** y un navegador compatible.
- **iOS:** Safari 16.4 o superior (WKWebView 14.3+). **Android:** Chrome/Firefox/Samsung Internet/Edge actualizados.
- La cámara no funciona por `http://` en red local. Usa un túnel HTTPS (ngrok, Cloudflare Tunnel) o un certificado válido.

## Puesta en marcha

```bash
npm install
npm run db:migrate
npm run db:seed
npm run prepare-targets
npm run dev
```

Abre http://localhost:5173. El frontend de desarrollo proxifica `/api`, `/image-targets` y `/media` al backend en `:3000`.

### Credenciales de demostración

| Usuario | Contraseña | Rol |
|---|---|---|
| `marketing` | `marketing123` | Dirección de Marketing |
| `gerencia` | `gerencia123` | Gerencia |
| `community` | `community123` | Community Manager |

Cambia estas contraseñas y `AUTH_SECRET` antes de cualquier uso real. Para una demostración sin login, define `AUTH_DISABLED=true` en el servidor.

### Probar desde el celular

La cámara exige un contexto seguro. Opciones recomendadas:

1. Túnel HTTPS: `ngrok http 5173` o `cloudflared tunnel --url http://localhost:5173`. Abre la URL HTTPS del túnel.
2. Producción local: `npm run build` y `npm start`, detrás de un proxy HTTPS.

No uses `http://<IP-LAN>:5173` para la experiencia AR: el navegador bloqueará la cámara.

## Experiencia pública y QR

- Cada campaña tiene una URL pública: `/ar/<campaignId>` (también se acepta `/?campaign=<campaignId>`).
- El QR se genera en `GET /api/v1/public/campaigns/<campaignId>/qr?size=512` y se puede descargar desde el modal del afiche.
- Configura `PUBLIC_BASE_URL` con la URL HTTPS pública para que los QR impresos apunten al dominio correcto.

## Producción

```bash
npm run build
NODE_ENV=production npm start
```

Define al menos:

```dotenv
DATABASE_URL="file:./dev.db"
PORT=3000
NODE_ENV=production
PUBLIC_BASE_URL="https://tu-dominio.example"
AUTH_SECRET="un-secreto-largo-y-aleatorio"
CORS_ORIGINS="https://tu-dominio.example"
```

Express sirve la API, los estáticos y la SPA. Para HTTPS se recomienda un proxy inverso (Caddy, Nginx o un túnel) delante del puerto 3000.

## 8th Wall

- Sin `VITE_8THWALL_APP_KEY`, se usa el motor open-source `@8thwall/engine@0.1.0` desde CDN o desde `VITE_XR_ENGINE_SRC`.
- La versión open-source es **pre-release**: fija la versión y repite las pruebas al actualizarla.
- Para mayor estabilidad en el mall, puedes self-hostear los artefactos del motor y apuntar `VITE_XR_ENGINE_SRC` a tu propia URL.
- La ruta antigua `apps.8thwall.com/xrweb?appKey=...` es legacy; verifica la licencia y disponibilidad antes de usarla.
- Image Targets no requiere SLAM. No se cargan modelos 3D ni reconocimiento facial.

## Pruebas

```bash
npm test
npm run build
```

La suite `tests/istqb-validation.test.js` usa una base SQLite de prueba con migraciones y cubre reglas de publicación, RBAC, validación de archivos, deduplicación, intervalos de seguimiento, versionado y campañas vencidas.

## Limitaciones documentadas

- La compatibilidad se verifica en dispositivos concretos; no se garantiza un funcionamiento idéntico en todos los equipos.
- Los reportes describen actividad registrada; no miden atención, visitas al local ni ventas.
- Las pruebas de aceptación se realizan con campañas ficticias y un grupo reducido de usuarios.
- Si el afiche impreso cambia de diseño, se debe generar y probar un nuevo image target.
