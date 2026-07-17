# Despliegue en Easypanel

Guía paso a paso para desplegar Finca La Unión en Easypanel (self-hosted sobre Docker, ver
decisión en `system-architecture.md`). Dominio de referencia usado en esta guía:
`finca.habiteka.app` — sustitúyelo por el tuyo si cambia.

No existe integración automática con Easypanel desde aquí: esta guía deja el repositorio
listo para desplegar (`Dockerfile`, migraciones automáticas, health check) y detalla los
pasos manuales exactos en la UI de Easypanel.

## Arquitectura: 3 servicios

1. **Postgres** — plantilla nativa de Easypanel.
2. **MinIO** — plantilla nativa de Easypanel. **Debe quedar accesible públicamente** (ver
   aviso crítico más abajo) — no solo por red interna.
3. **App (Nuxt)** — servicio construido desde este repo con el `Dockerfile` de la raíz.

## ⚠️ Aviso crítico: MinIO debe tener dominio público

Las fotos/comprobantes se sirven mediante URLs firmadas que genera el servidor
(`server/services/storage.ts`, `getSignedUrl`), pero esas URLs las abre directamente el
**navegador del usuario** (`<img src="...">`, descargas de comprobantes/adjuntos). Si
`MINIO_ENDPOINT` apunta al nombre de servicio interno de Easypanel (p. ej. `minio`,
resoluble solo dentro de la red Docker), el navegador del usuario no podrá resolverlo y
todas las fotos/adjuntos aparecerán rotos, aunque el resto de la app funcione perfectamente.

**Pasos:**
1. En el servicio MinIO de Easypanel, activa un dominio (p. ej. `minio.finca.habiteka.app`)
   apuntando al puerto de la API S3 (9000 internamente), con HTTPS.
2. Usa ese dominio público en `MINIO_ENDPOINT` (sin `https://`, solo el host),
   `MINIO_PORT=443` y `MINIO_USE_SSL=true` en las variables de entorno de la app.

## 1. Crear el servicio Postgres

- Plantilla "Postgres" de Easypanel. Anota usuario/contraseña/nombre de BD generados (o
  fíjalos tú) — se usan para construir `DATABASE_URL`.
- No hace falta crear tablas a mano: el contenedor de la app ejecuta
  `drizzle-kit migrate` automáticamente al arrancar (ver sección "Migraciones").

## 2. Crear el servicio MinIO

- Plantilla "MinIO" de Easypanel.
- Crea el bucket `fincatech-media` (o el nombre que uses en `MINIO_BUCKET`) — si no
  existe, `server/services/storage.ts` (`ensureBucket`) lo crea solo en la primera subida,
  pero es más predecible crearlo tú mismo desde la consola de MinIO.
- Configura el dominio público como se explica arriba (aviso crítico).

## 3. Crear el servicio de la app

- Fuente: este repositorio Git, rama `main` (o `develop` mientras no haya release estable).
- Build: Easypanel detecta el `Dockerfile` de la raíz automáticamente (multi-stage: build
  con `pnpm build`, runtime solo con dependencias de producción).
- Puerto interno: `3000` (`EXPOSE 3000` en el `Dockerfile`; `HOST=0.0.0.0`/`PORT=3000` ya
  fijados como `ENV` en la imagen).
- Dominio público: `finca.habiteka.app`, HTTPS.
- **Réplicas: exactamente 1.** `server/plugins/notification-dispatcher.ts` corre un cron
  en el propio proceso (`node-cron`, cada 30s) para vaciar la cola de notificaciones. Con
  2+ réplicas, cada una registraría su propio cron y podría duplicar el envío de
  notificaciones (email/Telegram) — no hay coordinación distribuida entre réplicas.
- Health check: `GET /api/health` (ya existe, comprueba conexión a Postgres y a MinIO;
  devuelve 503 si alguna falla).

### Variables de entorno

Copia estas desde `.env.example`, con valores reales de producción:

```
DATABASE_URL=postgres://<usuario>:<password>@<host-postgres-easypanel>:5432/<bd>

MINIO_ENDPOINT=minio.finca.habiteka.app   # dominio PÚBLICO, no el nombre interno del servicio
MINIO_PORT=443
MINIO_USE_SSL=true
MINIO_ACCESS_KEY=<access key de MinIO>
MINIO_SECRET_KEY=<secret key de MinIO>
MINIO_BUCKET=fincatech-media

BETTER_AUTH_SECRET=<generar, ver abajo>
BETTER_AUTH_URL=https://finca.habiteka.app   # debe coincidir EXACTO con el dominio público (sin barra final) — better-auth valida el Origin contra esta URL

# Opcionales — sin ellas la app arranca igual, con esas funciones desactivadas:
SMTP_HOST=smtp.gmail.com    # sin SMTP completo, las invitaciones no se envían por email:
SMTP_PORT=587                # el Admin recibe el enlace en la respuesta para compartirlo a
SMTP_USER=<cuenta>           # mano, y las notificaciones por email fallan con gracia (se
SMTP_PASS=<contraseña de aplicación>  # reintentan y acaban marcadas 'failed', sin tumbar nada)
SMTP_FROM="Finca La Unión <cuenta@gmail.com>"
NAN_BUILDERS_API_KEY=       # sin esto, el ticket OCR se degrada a entrada manual
TELEGRAM_BOT_TOKEN=         # sin esto, el bot de Telegram queda desactivado
TELEGRAM_WEBHOOK_SECRET=
```

Recomendado igualmente configurar SMTP real cuanto antes: sin él, invitar a nuevos
propietarios exige compartir el enlace de invitación a mano cada vez.

Generar `BETTER_AUTH_SECRET` (mínimo 32 caracteres aleatorios):
```bash
openssl rand -base64 32
```

`server/plugins/env-check.ts` valida TODAS las variables obligatorias al arrancar el
contenedor y falla rápido con un mensaje claro si falta alguna — si el contenedor no
arranca, revisa los logs del servicio en Easypanel primero. Las variables opcionales
(`NAN_BUILDERS_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`) admiten estar
completamente ausentes O en blanco: Easypanel (y otros PaaS) suelen inyectar un campo
vacío del formulario como `""` en vez de omitirlo del entorno, y `server/utils/env.ts`
trata ambos casos igual a propósito.

## 4. Migraciones

Automáticas: el `Dockerfile` arranca con
`drizzle-kit migrate && node .output/server/index.mjs` — cada arranque del contenedor
(deploy nuevo o reinicio) aplica las migraciones pendientes antes de levantar el servidor.
Es idempotente (verificado): reiniciar un contenedor ya migrado no falla ni duplica nada,
`drizzle-kit` solo aplica lo que falte.

Nota de diseño: `drizzle-kit` se movió a `dependencies` (en vez de solo `devDependencies`)
para que esta CLI exista en la imagen de producción. Es más pesado que necesario para "solo
aplicar migraciones" (arrastra su propia copia de `esbuild`) — una alternativa más ligera
sería el migrador programático de `drizzle-orm` (`drizzle-orm/node-postgres/migrator`) en
un plugin de Nitro. Se descartó por ahora para no introducir un cambio sin verificar
end-to-end de nuevo con Docker real en la misma sesión — el enfoque actual SÍ está
verificado (build + arranque + reinicio reales). Revisar si el tamaño de imagen importa.

## 5. Primer usuario Admin

No hay usuarios seed en producción (el seed de datos de prueba es solo para desarrollo
local). Tras el primer deploy exitoso, crea el primer Admin con:

```bash
curl -X POST https://finca.habiteka.app/api/auth/bootstrap-admin \
  -H "Content-Type: application/json" \
  -d '{"email":"tu@email.com","password":"contraseña-segura","name":"Tu Nombre"}'
```

Este endpoint (`server/api/auth/bootstrap-admin.post.ts`) solo funciona mientras no exista
ningún usuario REAL todavía — excluye explícitamente la cuenta interna `system-fondo-comun`
(creada automáticamente por `server/plugins/seed-fondo-comun.ts` en cada arranque, antes de
que exista ningún Admin; bug detectado y corregido en producción: sin esta exclusión, el
endpoint devolvía 403 desde el primer intento en TODO despliegue nuevo, porque contaba esa
cuenta de sistema como "ya existe un usuario"). En cuanto se crea el primer Admin real,
queda permanentemente inutilizable (no es un registro público). El resto de propietarios se
añaden después desde
`/members` (invitación por email).

## 6. Verificación post-deploy

1. `curl https://finca.habiteka.app/api/health` → `{"status":"ok","db":true,"minio":true}`.
2. Crear el primer Admin (paso 5) e iniciar sesión en `/login`.
3. Subir una foto de prueba (galería o una idea) y confirmar que la miniatura carga — si
   sale rota, revisa el aviso crítico de MinIO más arriba.
4. Revisar logs del servicio: debe aparecer
   `[notification-dispatcher] registrado, próxima ejecución: ...` una sola vez (no varias
   veces seguidas, que indicaría más de una réplica corriendo).
