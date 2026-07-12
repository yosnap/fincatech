# Arquitectura del Sistema — Finca La Unión

## Stack

- **Framework:** Nuxt 4 (Vue 3) + Nitro — monolito full-stack, frontend y servidor en el mismo proyecto.
- **Base de datos:** PostgreSQL (ACID + SSI), acceso vía **Drizzle ORM** con migraciones versionadas (`drizzle-kit`).
- **Almacenamiento de archivos:** MinIO (S3-compatible, self-hosted). Comprobantes de pago y fotos se comprimen en cliente antes de subir; bucket privado, acceso solo vía URL firmada temporal.
- **Auth:** Better Auth (sesión server-side, cookie httpOnly) — se implementa en la Fase 2.
- **OCR:** GPT-4o Vision + Structured Outputs — se implementa en la Fase 4.
- **Bot / notificaciones:** Telegram Bot API — se implementa en la Fase 5.
- **Gestor de paquetes:** pnpm.
- **Hosting objetivo:** Easypanel (PaaS self-hosted sobre Docker/VPS). PostgreSQL y MinIO se despliegan como servicios gestionados ahí en producción; en local se levantan vía `docker-compose.yml`.

## Estructura de carpetas

```
app/                    UI (Nuxt 4: pages, layouts, components, assets)
server/
  api/                  Endpoints REST (Nitro auto-routing)
  db/
    client.ts           Singleton del pool Drizzle
    schema/              Un archivo por dominio, reexportado en index.ts
  services/             Lógica de negocio y clientes externos (storage.ts, ...)
  utils/                Helpers de servidor (env.ts, ...)
  plugins/              Plugins Nitro (fail-fast de env al arrancar)
drizzle/migrations/     Migraciones versionadas
docs/                   Documentación del proyecto
plans/                  Planes de implementación por fase
```

## Decisiones clave

| Decisión | Razón |
|---|---|
| PostgreSQL sobre MySQL | Integridad transaccional (SSI) no negociable para el motor de deudas |
| Drizzle sobre Prisma | Menor overhead para una app monolítica de este tamaño; transacciones explícitas |
| MinIO sobre disco local | Persistencia de archivos independiente de redeploys del contenedor de la app |
| Better Auth sobre Lucia | Lucia deprecada por su autor desde marzo 2025, sin desarrollo activo |
| Easypanel sobre serverless | Proceso persistente simplifica el dispatcher de notificaciones (Fase 5), sin límites de scheduled functions |
| pnpm sobre bun | Mayor precedente documentado con el stack (Nuxt/Nitro/Drizzle + paquetes nativos como `pg` y el SDK de MinIO) en build Docker |

Detalle completo de cada decisión: `plans/260712-2157-plataforma-gestion-copropiedad/plan.md` y sus reportes de research/red-team.
