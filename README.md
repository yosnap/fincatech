# Finca La Unión — Plataforma de Gestión de Copropiedad

Gestor web de gastos, pagos, ideas/propuestas, votación de derramas, tareas, fotos y notificaciones para los copropietarios de la finca.

- PRD: [`docs/prd.md`](./docs/prd.md)
- Plan de implementación: [`plans/260712-2157-plataforma-gestion-copropiedad/plan.md`](./plans/260712-2157-plataforma-gestion-copropiedad/plan.md)
- Arquitectura: [`docs/system-architecture.md`](./docs/system-architecture.md)

## Stack

Nuxt 4 + Nitro · PostgreSQL + Drizzle ORM · MinIO (almacenamiento) · Better Auth · pnpm

## Desarrollo local

```bash
docker compose up -d   # PostgreSQL + MinIO
pnpm install
pnpm dev
```
