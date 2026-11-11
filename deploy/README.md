# Producción: armodels.dsmerch.com

Base solicitada: `16f82d153be73a5b1259ffca5a744ef453759082`. Los cambios de
seguridad y los archivos de operación se guardan por separado para conservar
`main` en esa referencia. CI/CD queda pendiente por indicación del propietario.

## Instalación

- Código: `/var/www/armodels/releases/<release>`; enlace `current` controlado por root.
- Datos: `/var/lib/armodels/production.db`, propietario `armodels`, directorio 0700.
- Configuración: `/etc/armodels/production.env`, root:root 0600. Contiene
  `NODE_ENV=production`, `PUBLIC_ORIGIN=https://armodels.dsmerch.com`,
  `DATABASE_URL=file:/var/lib/armodels/production.db` y `ADMIN_PROXY_TOKEN` aleatorio.
- Aplicación: usuario `armodels`, sin login. Código root:armodels, sin escritura
  para el proceso. Dependencias de desarrollo excluidas del runtime.
- Compilación: usuario separado `armodels-build`, sin login ni acceso a los datos.
- Servicios: `armodels.socket` y `armodels.service`, plantillas en `systemd/`.
  El socket escucha en `127.0.0.1:18091`. El proceso recibe el descriptor de
  systemd dentro de una red privada, sin salida a Internet ni a otros servicios.
  Su espacio de archivos oculta los demás proyectos y configuraciones privadas.
- NGINX: `/etc/nginx/conf.d/armodels.dsmerch.com.conf`; snippets exclusivos
  en `/etc/nginx/armodels/`. La autenticación HTTP Basic protege el panel y todas
  las rutas administrativas. El token del proxy se reemplaza en NGINX; las
  cabeceras enviadas por clientes no conceden permisos.
- Certificado: Certbot `certonly --webroot -w /var/lib/armodels-acme`;
  renovación con el timer existente y un deploy hook dedicado que primero
  ejecuta `nginx -t` y luego recarga NGINX.

No copiar credenciales, bases ni el token a Git. Los archivos de `nginx/` son
plantillas sin secretos. `admin-proxy.conf` y `admin.htpasswd` se generan en el
servidor. La cuenta inicial del panel se guarda en un archivo accesible solo por
root y se entrega al propietario fuera del repositorio.

## Validación y operación

```bash
systemctl status armodels.socket armodels.service
journalctl -u armodels.service -n 50 --no-pager
curl --fail http://127.0.0.1:18091/api/v1/health
nginx -t
certbot renew --cert-name armodels.dsmerch.com --dry-run
```

`npm test` utiliza exclusivamente `prisma/test.db`; nunca apuntarlo a producción.
`npm run db:seed` solo admite una base vacía: se niega a borrar o reemplazar datos.
Las migraciones se ejecutan con `prisma migrate deploy` desde una compilación
aislada con Prisma CLI disponible. No instalar paquetes ni ejecutar scripts npm
como root. No usar `prisma migrate dev` en producción.

Para una actualización manual: preparar otra versión, ejecutar pruebas y build,
respaldar SQLite con su API de backup, aplicar únicamente migraciones revisadas,
excluir dependencias de desarrollo y dejar el código root:armodels. Cambiar
`current` de forma atómica y reiniciar exclusivamente `armodels.service`.
Comprobar salud, autenticación y los sitios existentes después del cambio.

## Recuperación

Para volver al código anterior, verificar que el destino esté dentro de
`/var/www/armodels/releases/`, apuntar `current` a esa versión y reiniciar solo
`armodels.service`. No restaurar automáticamente SQLite: una migración puede
requerir recuperar la copia tomada antes de desplegar. Detener el servicio antes
de restaurar datos y conservar la base actual para investigación.

Para retirar este primer despliegue, detener y deshabilitar únicamente
`armodels.service` y `armodels.socket`, retirar el bloque NGINX exclusivo y su
deploy hook, validar NGINX y recargarlo. Conservar datos y respaldos. No cambiar
el firewall global ni la configuración de otros sitios.

La copia previa de NGINX y el inventario de respuestas de los sitios existentes
están en `/root/armodels-deploy-20261111T183855Z/` en NarcServ.
