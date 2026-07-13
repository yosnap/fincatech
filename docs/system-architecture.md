# Arquitectura del Sistema — Finca La Unión

## Stack

- **Framework:** Nuxt 4 (Vue 3) + Nitro — monolito full-stack, frontend y servidor en el mismo proyecto.
- **Base de datos:** PostgreSQL (ACID + SSI), acceso vía **Drizzle ORM** con migraciones versionadas (`drizzle-kit`).
- **Almacenamiento de archivos:** MinIO (S3-compatible, self-hosted). Comprobantes de pago y fotos se comprimen en cliente antes de subir; bucket privado, acceso solo vía URL firmada temporal.
- **Auth:** Better Auth (sesión server-side, cookie httpOnly) + plugin `admin` con roles custom `admin`/`owner`/`guest`. Sin auto-registro público (`disableSignUp`): las cuentas se crean solo vía invitación (`/api/auth/accept-invite`) o el bootstrap del primer Admin (`/api/auth/bootstrap-admin`, se autodeshabilita en cuanto existe un usuario). Envío de invitaciones por SMTP (Gmail).
- **OCR:** GPT-4o Vision + Structured Outputs (`OPENAI_API_KEY` opcional — sin ella, la subida de tickets se degrada a 503 y el gasto se registra manualmente; el resto de la app arranca igual). Implementado en la Fase 4, **sin verificar aún contra la API real** (ver `plans/260712-2157-plataforma-gestion-copropiedad/phase-04-*.md`).
- **Bot / notificaciones:** Telegram Bot API (`TELEGRAM_BOT_TOKEN`/`TELEGRAM_WEBHOOK_SECRET` opcionales — sin ellos el webhook responde 503, el resto de la app arranca igual) + email SMTP (Fase 2). Implementado en la Fase 5, **sin verificar aún contra la API real de Telegram**.
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
  utils/                Helpers de servidor (env.ts, auth.ts, rbac.ts, audit.ts, email.ts, ...)
  middleware/            Middleware Nitro por-request (auth.ts hidrata event.context.user)
  plugins/              Plugins Nitro (fail-fast de env al arrancar)
drizzle/migrations/     Migraciones versionadas
docs/                   Documentación del proyecto
plans/                  Planes de implementación por fase
```

## Auth y RBAC (Fase 2)

- `server/utils/auth.ts`: instancia Better Auth (drizzleAdapter + plugin `admin` con roles admin/owner/guest vía `server/utils/permissions.ts`).
- `server/middleware/auth.ts`: hidrata `event.context.user` (id/role/banned) en cada request.
- `server/utils/rbac.ts`: `requireRole(event, roles[])` y `canSeeIndividualDebt(user)` — el Invitado nunca ve desglose de deuda individual, solo agregados.
- `server/utils/audit.ts`: `writeAuditLog` (tabla `audit_log`, solo inserción) — se llama explícitamente desde cada endpoint de `server/api/members/*` y `server/api/auth/{accept-invite,bootstrap-admin}.post.ts`.
- `server/api/auth/[...all].ts`: monta login/logout/get-session de Better Auth vía `toNodeHandler` (h3 v2 no soporta el helper `toWebRequest` de la guía oficial de Better Auth para Nuxt). Bloquea explícitamente las rutas nativas `/api/auth/admin/*` del plugin admin (no auditan ni tienen los guards anti-autobloqueo de `server/api/members/*`).
- Gestión de miembros: únicamente vía `server/api/members/*` (invite/role/deactivate), todos con `requireRole(['admin'])` + `writeAuditLog`.
- Frontend: `app/utils/auth-client.ts` (cliente singleton, uso client-side) y `app/composables/use-auth.ts` (cliente request-scoped con `baseURL` absoluto, necesario en SSR — el singleton con URL relativa falla en middlewares de ruta server-side).

> **`h3` fijado a la versión exacta de Nitro (`1.15.11`).** No añadir `h3` como dependencia con un rango de versión abierto: Nuxt/Nitro trae su propia copia interna, y una segunda versión compitiendo rompe el auto-import de `readBody`/`createError` en toda la app (ver nota post-hoc en `plans/260712-2157-plataforma-gestion-copropiedad/phase-03-*.md`). Si algún archivo bajo `server/` necesita importar algo de `h3`, que sea `import type` (se borra en build) — nunca un import de valor.

## Contabilidad y deudas (Fase 3)

- `server/db/schema/expenses.ts`: `expenses` (importes en céntimos enteros, `participant_snapshot` jsonb congelado en el momento de creación), `debts` (deudor→acreedor, estado pending/pending_confirmation/confirmed), `payment_proofs` (polimórfica: comprobantes de gasto o de pago de cuota).
- `server/services/debt-splitter.ts`: función pura de reparto — división entera determinista, el residuo se lo lleva el último participante (orden por `userId`). Sin dependencias de DB, 100% testeable.
- `server/services/expense-service.ts`: `createExpense`/`markDebtPaid`/`confirmDebtReceipt`, todo dentro de `db.transaction`. Concurrencia resuelta con `SELECT ... FOR UPDATE` (sobre la cuota individual y, al recalcular el estado agregado del gasto, también sobre la fila de `expenses`) en vez de aislamiento `SERIALIZABLE` con reintentos.
- `server/db/seed/fondo-comun.ts`: usuario de sistema no autenticable, sembrado en el arranque (`server/plugins/seed-fondo-comun.ts`), reservado para la Fase 7 (derramas). Excluido de la gestión de miembros de la Fase 2.
- `server/utils/file-signature.ts`: valida los magic bytes reales de un comprobante subido contra su `Content-Type` declarado (el declarado por el cliente no es de fiar).

## OCR de tickets (Fase 4)

- `server/services/vision-ocr.ts`: única puerta a la API de GPT-4o Vision (Structured Outputs, `response_format: json_schema` estricto). Reutilizable por el bot de Telegram (Fase 5).
- Flujo: `POST /api/ocr/extract` (sube imagen, llama a Vision, devuelve un borrador) → revisión humana editable en `app/pages/expenses/new-from-ticket.vue` → `POST /api/ocr/confirm` (persiste el borrador YA corregido; nunca crea el gasto directamente desde la extracción cruda). Solo JPEG/PNG — PDF se registra manualmente (Fase 3), no vía OCR.
- `createExpense` (Fase 3) acepta un `proof` opcional ya subido a MinIO — el comprobante se sube antes de escribir en DB y su fila en `payment_proofs` se inserta en la misma transacción que el gasto (mismo patrón que `markDebtPaid`).

## Bot de Telegram y notificaciones (Fase 5)

- `server/routes/webhook/telegram.post.ts`: público a propósito (Telegram no manda cookie de sesión); autenticado por `secret_token` (comparación de tiempo constante) + dedupe atómico por `update_id`. Comando `/link TOKEN` vincula `chat_id`↔usuario; una foto pasa por `vision-ocr` (Fase 4) y responde con un link de confirmación cuyo borrador viaja codificado en la propia URL (sin tabla intermedia).
- `server/services/notification-service.ts`: `enqueueNotification` escribe en `notifications_outbox` DENTRO de la transacción del evento de dominio (p.ej. `createExpense`), nunca hace I/O de red ahí. `dispatchPendingNotifications` (cron cada 30s, `server/plugins/notification-dispatcher.ts`, `noOverlap: true`) reclama filas de forma atómica antes de enviar — evita reenvíos duplicados por solapamiento. Tras `MAX_ATTEMPTS` (5) sin éxito, la fila se marca `failed` explícitamente.
- Preferencias de canal por usuario en `/profile` (`notification_preferences`, email=on/telegram=off por defecto).
- HTML de notificación siempre escapado antes de interpolar texto libre (descripción de gasto) — ver `escapeHtml` en `notification-service.ts`.

## Ideas, propuestas y votación (Fase 6)

- `server/services/proposal-service.ts`: `promoteIdea` (idea→propuesta, solo Admin o autor, `FOR UPDATE` sobre la idea), `castVote` (`UNIQUE(voter_id, proposal_id)` en DB, `FOR UPDATE` sobre la propuesta), `closeProposal` (idempotente, mayoría simple o `overrideQuoteId` de Admin en empates/sin votos; cerrar exige Admin o autor en ambos caminos).
- `proposals.winningQuoteId` sin FK real a `quotes.id` a propósito (evita ciclo `proposals↔quotes`); se valida en la capa de aplicación.
- Cotizaciones (`quotes`) aceptan un PDF opcional validado por magic bytes y servido vía URL firmada temporal (`GET /api/proposals/[id]/quotes/[quoteId]/attachment`), mismo patrón que los comprobantes de la Fase 3.
- El Invitado tiene acceso de solo lectura (ve ideas/propuestas y el tally agregado de votos, nunca quién votó qué); todo lo que muta (crear, comentar, promover, cotizar, votar, cerrar) exige `admin`/`owner`.

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
