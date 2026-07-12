---
phase: 1
title: "Setup e infraestructura base"
status: pending
priority: P1
effort: 6h
dependencies: []
roadmap: "F1 · MVP financiero"
---

# Phase 1: Setup e infraestructura base

## Context links
- PRD §2 (Stack), §5 (No funcionales) — `docs/prd.md`
- Stack decidido — `research/researcher-01-stack-report.md`

## Overview
- **Fecha:** 2026-07-12
- **Descripción:** Bootstrap del monolito Nuxt 3 + Nitro, conexión PostgreSQL, Drizzle ORM con migraciones, MinIO como almacenamiento de archivos (comprobantes/fotos), layout base mobile-first (Nuxt UI + Tailwind), gestión de secretos y esqueleto de esquema. Despliegue objetivo: Easypanel (PaaS self-hosted sobre Docker en VPS propio). Base sobre la que se apoyan todas las fases.
- **Prioridad:** P1
- **Estado de implementación:** Pendiente
- **Estado de revisión:** No revisado

## Key Insights
- Nuxt/Nitro elegido por webhooks sin boilerplate (`/server/routes/*.post.ts`), clave para Fase 5.
- PostgreSQL elegido por ACID + SSI (write-skew) — no negociable: la integridad de deudas depende de esto.
- Drizzle: schema en TS puro, transacciones explícitas. Instalar `drizzle-kit` para migraciones versionadas desde el día 1.
- **Hosting confirmado: Easypanel** (VPS propio vía Docker). Easypanel ofrece templates de un clic para PostgreSQL y MinIO — desplegar ambos como servicios gestionados en el mismo panel, evita depender de Neon/Supabase externos.
- **Almacenamiento de archivos: MinIO** (S3-compatible, self-hosted). Todos los comprobantes/fotos (Fases 3, 4, 6, 7, 8) suben aquí, no al disco local del contenedor de la app (evita perder archivos en redeploys).
- Al ser VPS/Docker persistente (no serverless), el dispatcher de notificaciones (Fase 5) puede ser un proceso en background simple (`node-cron` en el mismo contenedor) o un Cron Job de Easypanel — sin las limitaciones de scheduled functions serverless.
- Mobile-first obligatorio (PRD §5): los tickets se suben desde el móvil in situ.
- Proyecto greenfield: no hay código previo; todas las rutas son a crear.
- **Gestor de paquetes: pnpm** (confirmado). Nuxt no fuerza ninguno; pnpm es el más probado con el ecosistema Nuxt/Nitro/Drizzle-kit y con paquetes nativos (`pg`, SDK MinIO) en build de Docker. `bun` quedó descartado por menor precedente documentado con este stack concreto, no por incompatibilidad conocida.

## Requirements
- **Funcional:** app arranca en dev y prod; healthcheck DB + MinIO; migración inicial aplicable/revertible; layout responsive base con navegación por rol (placeholder).
- **No funcional:** conexión DB por pool; secretos solo vía env (nunca en repo); tipado estricto TS; migraciones idempotentes; bucket MinIO privado con acceso solo vía URLs firmadas.

## Architecture
```
Nuxt 3 (Vue 3) ── Nitro server ── Drizzle ── PostgreSQL (Easypanel)
  app/ (UI mobile-first)      server/ (api, routes, db, utils)
  Tailwind + Nuxt UI          drizzle/ (schema + migrations)
                               server/services/storage.ts ── MinIO (Easypanel, S3-compatible)
Despliegue: Easypanel (Docker sobre VPS)
```
- `server/db/client.ts`: singleton pool Drizzle (lifetime = proceso; NO estado por request aquí).
- `server/db/schema/`: un archivo por dominio (users, expenses, …) reexportados en `index.ts` (< 1000 líneas/archivo, regla del proyecto).
- `server/services/storage.ts`: cliente MinIO (SDK compatible S3) — único punto de subida/descarga, URLs firmadas con expiración, reutilizado por Fases 3/4/6/7/8.
- Config env validada al arranque (fail-fast si falta `DATABASE_URL` o credenciales MinIO).

## Related code files
- Create: `nuxt.config.ts`, `drizzle.config.ts`, `.env.example`, `.gitignore`, `pnpm-lock.yaml`
- Create: `server/db/client.ts`, `server/db/schema/index.ts`
- Create: `server/services/storage.ts` (cliente MinIO, subida/descarga/URL firmada)
- Create: `server/utils/env.ts` (validación zod de env, incl. `MINIO_*`)
- Create: `app/layouts/default.vue`, `app/app.vue`
- Create: `docs/system-architecture.md` (stack + decisiones)
- Create: `docker-compose.yml` o config Easypanel (app + referencia a servicios Postgres/MinIO gestionados)

## Implementation Steps
1. `pnpm dlx nuxi init` (gestor de paquetes: **pnpm**, decisión confirmada); añadir Tailwind, Nuxt UI, `drizzle-orm`, `drizzle-kit`, `pg`, `zod`, SDK de MinIO (`minio` o cliente S3 compatible) vía `pnpm add`.
2. Configurar `drizzle.config.ts` apuntando a `server/db/schema` y carpeta `drizzle/migrations`.
3. Crear pool Drizzle en `server/db/client.ts` (reutilizable, no recrear por request).
4. Desplegar PostgreSQL y MinIO como servicios en Easypanel; crear bucket privado para comprobantes/fotos.
5. `server/services/storage.ts`: subida, generación de URL firmada temporal, borrado.
6. Validación de env fail-fast en `server/utils/env.ts`; `.env.example` con `DATABASE_URL` y `MINIO_*` (sin valores reales).
7. Schema semilla mínimo (tabla `users` placeholder) + primera migración; verificar `up`/`down`.
8. Layout mobile-first con slot de navegación condicionada por rol (placeholder hasta Fase 2).
9. Endpoint `GET /api/health` que hace `SELECT 1` + comprueba conectividad MinIO.
10. Documentar stack/decisiones (incl. Easypanel + MinIO) en `docs/system-architecture.md`.

## Todo list
- [ ] Proyecto Nuxt inicializado con Tailwind + Nuxt UI
- [ ] Drizzle + drizzle-kit configurados con migraciones versionadas
- [ ] Pool DB singleton + validación env fail-fast
- [ ] PostgreSQL + MinIO desplegados en Easypanel, bucket privado creado
- [ ] `storage.ts` con subida + URL firmada
- [ ] Migración inicial reversible aplicada
- [ ] Layout base responsive + healthcheck DB+MinIO
- [ ] `docs/system-architecture.md` creado

## Success Criteria
- [ ] `pnpm dev` arranca sin errores y `/api/health` devuelve 200 con DB y MinIO OK.
- [ ] `drizzle-kit generate` + `migrate` crean y revierten la migración inicial.
- [ ] Layout se ve correcto en viewport 375px (mobile-first).
- [ ] No hay secretos en el repo; `.env` en `.gitignore`.
- [ ] Subir un archivo de prueba a MinIO y recuperarlo vía URL firmada funciona end-to-end.

## Risk Assessment
| Riesgo | Prob×Impacto | Mitigación |
|--------|--------------|------------|
| Migraciones no reversibles desde el inicio | Media×Alto | Adoptar drizzle-kit + revisar `down` en cada migración desde Fase 1 |
| ~~Elección de hosting DB retrasa avance~~ | — | Resuelto: Easypanel con templates de Postgres/MinIO |
| ~~Hosting de compute no soporta tareas programadas~~ | — | Resuelto: Easypanel es VPS/Docker persistente, soporta cron/procesos en background sin límites serverless |
| Bucket MinIO mal configurado (público por error) | Baja×Alto | Bucket privado por defecto; acceso solo vía URLs firmadas con expiración corta |
| Menor adopción de Drizzle (menos respuestas SO) | Baja×Bajo | Docs oficiales; mantener queries simples y tipadas |

## Security Considerations
- Secretos solo en env; nunca commitear `.env`, tokens ni credenciales (regla del proyecto).
- TLS obligatorio en conexión a PostgreSQL gestionado y a MinIO.
- Bucket MinIO privado; servir archivos solo vía URL firmada temporal, nunca acceso público directo.
- Base para auditoría (Fase 2): definir ya columnas `created_at`/`updated_at` con `timestamptz`.

## Next steps
Fase 2: autenticación y RBAC de 3 roles sobre este esqueleto.
