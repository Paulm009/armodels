# Verificación del despliegue del 11 de noviembre de 2026

Sitio: https://armodels.dsmerch.com

Código desplegado: `16d459aa96472f5e09501dc9346041c3eca24292`, derivado de
`16f82d153be73a5b1259ffca5a744ef453759082`. La rama `main` conserva la referencia
solicitada; los ajustes están en `codex/production-hardening`. No se configuró CI/CD.

## Actualización: demo público sin Basic

Por indicación explícita del propietario, se retiró HTTP Basic del panel y de las
rutas administrativas. El acceso de lectura y edición es público. El token
interno solo verifica que la petición provenga del proxy NGINX; no autentica a
visitantes. Se mantienen el aislamiento del proceso y los límites de recursos.

- Panel, salud, locales, campañas y reportes: HTTP 200 sin credenciales ni
  cabecera `WWW-Authenticate`.
- Una petición anónima de edición con datos incompletos alcanza la validación
  de entrada (HTTP 400), sin crear ni modificar registros.
- El navegador muestra el panel con sus campañas y locales sin pedir login.
- Origen externo rechazado con HTTP 403; integridad SQLite correcta.
- `nginx -t` correcto y recarga completada. La aplicación mantuvo su mismo PID.
- No se modificaron los archivos de configuración NGINX de otros proyectos.
- Credenciales Basic retiradas de la configuración activa y archivadas en
  `/root/armodels-remove-basic-20261111T191051Z/`, junto con el respaldo para revertir.

## Comprobaciones del despliegue inicial

- Ubuntu 24.04 / Node 24: las 8 pruebas originales y las 9 de seguridad pasan.
- Compilación Vite completada en un proceso sin privilegios y con recursos limitados.
- `npm audit --omit=dev`: cero vulnerabilidades conocidas. Se retiraron Vite,
  Prisma CLI y el resto de las dependencias de desarrollo del runtime.
- Una migración aplicada exclusivamente a la base nueva de Armodels.
- Integridad SQLite: `ok`; 2 locales y 4 versiones de campañas iniciales.
- Repetir el seed sobre la base poblada se rechaza; los datos se conservan.
- URLs de los QR configuradas con el dominio de producción.
- Salud HTTPS, panel autenticado, API administrativa autenticada y consulta de
  campaña pública: HTTP 200. Sin credenciales, panel y administración: HTTP 401.
- Un rol y credenciales de proxy falsificados no conceden acceso; un origen
  externo recibe HTTP 403 y `/.env` recibe HTTP 404.
- Reinicio del servicio: salud y campaña activa correctas; SQLite conserva los
  registros y supera nuevamente su comprobación de integridad.
- Socket HTTP visible únicamente en `127.0.0.1:18091`.
- Verificación dentro de los espacios de red y archivos del proceso, con su UID:
  solo se ve el proyecto Armodels, el código no es escribible, los datos sí lo son,
  no se ve la configuración NGINX y no hay acceso a PostgreSQL, Redis ni Internet.
- Las 35 respuestas HTTP de los dominios existentes coinciden con el inventario
  previo. Los 33 archivos originales de NGINX mantienen sus hashes. Todos los
  servicios previamente activos siguen activos y no hay unidades fallidas.
- Certificado de confianza pública emitido, válido hasta el 9 de febrero de 2027.
  Renovación simulada con hooks: correcta. Timer de renovación: habilitado y activo.

## Evidencia y límites

La copia previa, la base inicial de respaldo y el detalle de las comprobaciones
están en `/root/armodels-deploy-20261111T183855Z/`, accesible solo por root.
Las credenciales administrativas están fuera del repositorio y no aparecen en
los registros de validación.

En el despliegue inicial, las peticiones autenticadas comprobaron la entrega del
panel y sus APIs; el navegador automático no pudo atravesar HTTP Basic. Tras
retirar Basic, se verificó el panel en el navegador sin credenciales. No se ha
realizado una prueba física de cámara. El script CDN del motor WebAR y el de
Tailwind responden HTTP 200.

La suite original falla al arrancar el motor de migración Prisma en este equipo
Windows; en el servidor Linux las 17 pruebas y la compilación se completaron.
Las herramientas de desarrollo de generación de imágenes conservan avisos de
dependencias; esas herramientas se excluyeron de la aplicación en ejecución.

Este es el primer despliegue: no existe una versión productiva anterior. Hay
respaldo de configuración y datos, separación de versiones y procedimiento de
recuperación documentado. La auditoría de dependencias y las pruebas realizadas
no equivalen a una garantía de ausencia de todas las vulnerabilidades.
