# Sistema WebAR para Paseo Aranjuez

Aplicación del Proyecto de Grado **«Sistema WebAR basado en Image Tracking para la promoción interactiva de los locales comerciales de Paseo Aranjuez»**, de Nicolette Chalup, Universidad Católica Boliviana, Cochabamba.

**Producción:** https://armodels.lbct95.workers.dev

Stack: React + Vite, 8th Wall y Three.js en el navegador; Cloudflare Workers para la API REST y Cloudflare D1 (SQLite) para la persistencia. El backend usa `Request`, `Response`, Web Crypto y el binding `DB`; no necesita un servidor Express, Prisma, motores nativos ni un filesystem en producción.

## Desarrollo local

Requisitos: Node.js 22.12 o superior (probado con Node 24), npm y Git. Wrangler está fijado en las dependencias del proyecto.

```bash
npm ci
# Copiar .dev.vars.example a .dev.vars y elegir una clave local de administración.
npm run db:migrate
npm run dev
```

El frontend se abre en http://localhost:5173 y la API en http://localhost:8787. Vite redirige `/api`, `/image-targets` y `/media` al Worker local. Los datos persisten en `.wrangler/state/`; no se usa la base remota al desarrollar ni al ejecutar las pruebas.

`npm start` sirve el build con Wrangler local; ejecutar `npm run build` antes. La cámara requiere HTTPS en móviles; la URL de producción ya lo proporciona.

## Desplegar con el CLI de Cloudflare (Wrangler)

```bash
npx wrangler login
npx wrangler whoami
# Configurar ADMIN_TOKEN una vez, con una clave privada larga y aleatoria:
npx wrangler secret put ADMIN_TOKEN
npm run deploy
```

`npm run deploy` verifica la sesión, compila la web y sus recursos, aplica únicamente las migraciones pendientes a D1 y despliega el Worker y los assets. Las migraciones no borran tablas ni reinician datos. La base `armodels-db` y su binding `DB` están declarados en `wrangler.jsonc` junto con la cuenta del despliegue.

Para usar otra cuenta, crear una base propia con `npx wrangler d1 create armodels-db` y actualizar `account_id` y `database_id` en la configuración antes de desplegar. No reutilizar el identificador de esta base en otra cuenta.

```bash
npm run deploy:check    # build y empaquetado del Worker sin publicar
npm run db:deploy       # solo migraciones remotas
npx wrangler tail      # observar peticiones y errores
```

### Administración

Las consultas del panel y las experiencias WebAR son públicas, como en la demostración original. Crear o editar locales y campañas requiere `Authorization: Bearer <ADMIN_TOKEN>`. El panel solicita la clave al guardar y la conserva solo en memoria hasta recargar la página; nunca se incluye en el build ni en Git. Las cabeceras `x-admin-role` del cliente no conceden permisos.

En desarrollo, Wrangler lee el secreto desde `.dev.vars`; en producción se almacena con `wrangler secret put`. Si la clave no está configurada, el Worker rechaza las escrituras. Los parámetros `date` y `referenceDate` enviados por HTTP no pueden alterar la vigencia real de una promoción.

### Uso gratuito

La aplicación utiliza Workers, D1 y Static Assets, sin contratar recursos adicionales. La configuración mantiene los archivos estáticos fuera del Worker; solo la API y los fallbacks de navegación ejecutan código. Los afiches y los medios se incluyen en el despliegue: para agregar archivos nuevos, incorporarlos al repositorio y volver a compilar/publicar.

El [plan Workers Free](https://developers.cloudflare.com/workers/platform/pricing/) incluye 100.000 peticiones dinámicas al día y 10 ms de CPU por ejecución; los assets estáticos tienen peticiones gratuitas e ilimitadas. [D1 Free](https://developers.cloudflare.com/d1/platform/pricing/) incluye 5 millones de filas leídas al día, 100.000 escritas al día y 5 GB totales por cuenta (máximo 500 MB por base). Los límites se comparten con los demás proyectos de la cuenta. Al agotar la cuota gratuita, las operaciones se rechazan hasta el reinicio de la cuota; no se activa automáticamente un plan de pago.

Los reportes se agregan dentro de SQLite y se obtienen con un número constante de consultas, evitando cargar el historial completo de eventos en la memoria o CPU del Worker.

## Datos y migraciones

- `migrations/0001_initial.sql`: las siete entidades del sistema, claves foráneas e índices.
- `migrations/0002_demo_data.sql`: dos locales, cuatro versiones de campañas y sus objetivos y contenidos de demostración. Wrangler la aplica una sola vez por base; los siguientes despliegues preservan los cambios y la telemetría.
- `scripts/generate-d1-seed.js`: genera el SQL de demostración de forma determinista, sin conectarse a ninguna base ni borrar datos. `npm run db:seed:generate` regenera el archivo antes de su primera aplicación; una migración ya aplicada se conserva y los cambios posteriores se agregan en archivos nuevos.

Una campaña, su imagen objetivo y su contenido se guardan en una transacción D1 (`batch`). La siguiente versión se calcula dentro de la transacción para admitir publicaciones concurrentes. Los reintentos de eventos se deduplican con `event_id` único; el alta y los cambios de sesión se guardan junto con el evento. Una sesión no puede cambiar de campaña o versión.

## Estructura

- `src/server/worker.mjs`: rutas HTTP, límites del cuerpo JSON, autorización administrativa y acceso a assets.
- `src/server/core-service.js`: reglas de campaña, validación, RBAC, serialización y contrato de los siete indicadores operativos.
- `src/server/d1-repository.js`: consultas parametrizadas, transacciones y agregación de métricas.
- `wrangler.jsonc`: Worker, cuenta, assets y binding D1.
- `client/`: panel React y experiencia WebAR.
- `image-targets/`: metadata, luminancia, miniaturas y afiches de 8th Wall.
- `public/media/`: recursos promocionales que Vite copia al build.

## 8th Wall

Sin `VITE_8THWALL_APP_KEY`, el motor open-source se carga desde CDN con Image Tracking. La clave opcional permite utilizar el motor en la nube de 8th Wall. Las variables `VITE_*` son públicas y se pueden configurar en `.env` antes de compilar; nunca colocar secretos de Cloudflare o de administración allí.

```bash
npm run prepare-targets  # regenera afiches y metadata con el CLI de 8th Wall
npm run build           # copia también image-targets/ y public/media/
```

## Pruebas

```bash
npm test
```

Compila el frontend, empaqueta el mismo Worker que se despliega y ejecuta las 8 pruebas ISTQB originales y 12 pruebas de integración HTTP/D1 sobre workerd/Miniflare, con bases temporales aisladas. Cubren vigencias, metadatos reales, autorización, validación, transacciones con rollback, publicaciones concurrentes, reintentos simultáneos, consistencia de sesiones, reportes de más de 50 campañas y equivalencia de los siete indicadores con el cálculo original.
