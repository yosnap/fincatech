# Arquitectura del Sistema — Finca La Unión

## Stack

- **Framework:** Nuxt 4 (Vue 3) + Nitro — monolito full-stack, frontend y servidor en el mismo proyecto.
- **Base de datos:** PostgreSQL (ACID + SSI), acceso vía **Drizzle ORM** con migraciones versionadas (`drizzle-kit`).
- **Almacenamiento de archivos:** MinIO (S3-compatible, self-hosted). Comprobantes de pago y fotos se comprimen en cliente antes de subir; bucket privado, acceso solo vía URL firmada temporal.
- **Auth:** Better Auth (sesión server-side, cookie httpOnly) + plugin `admin` con roles custom `admin`/`owner`/`guest`. Sin auto-registro público (`disableSignUp`): las cuentas se crean solo vía invitación (`/api/auth/accept-invite`) o el bootstrap del primer Admin (`/api/auth/bootstrap-admin`, se autodeshabilita en cuanto existe un usuario). Envío de invitaciones por SMTP (Gmail).
- **OCR:** `gemma4` (multimodal, 26B/4B activos) vía nan.builders — API compatible con OpenAI (`response_format: json_schema` en modo estricto) en `https://api.nan.builders/v1` (`NAN_BUILDERS_API_KEY` opcional — sin ella, la subida de tickets se degrada a 503 y el gasto se registra manualmente; el resto de la app arranca igual). Implementado y **verificado contra la API real** en la Fase 4 (ver `plans/260712-2157-plataforma-gestion-copropiedad/phase-04-*.md`). Servicio de comunidad con cuota de tokens, sin coste por imagen a registrar (a diferencia de un proveedor de pago por uso).
- **Bot / notificaciones:** Telegram Bot API (`TELEGRAM_BOT_TOKEN`/`TELEGRAM_WEBHOOK_SECRET` opcionales — sin ellos el webhook responde 503, el resto de la app arranca igual) + email SMTP (Fase 2). Implementado en la Fase 5, **sin verificar aún contra la API real de Telegram**.
- **Gestor de paquetes:** pnpm.
- **Hosting objetivo:** Easypanel (PaaS self-hosted sobre Docker/VPS). PostgreSQL y MinIO se despliegan como servicios gestionados ahí en producción; en local se levantan vía `docker-compose.yml`. Guía de despliegue paso a paso: `docs/deployment.md`.

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
- **`taxCents` (2026-07-13):** el modelo extrae impuestos/IVA además del importe total, pero hasta esta fecha se descartaba tras la extracción (ni se mostraba en el paso de revisión ni se guardaba). Se añadió columna `expenses.tax_cents` (nullable, ya incluido en `amountCents`, no se suma aparte), campo editable en el paso de revisión de `new-from-ticket.vue` y `from-telegram.vue`, y visible en `/ledger/[id]`. Aplica también a la creación manual de gastos (`POST /api/expenses`), no solo al flujo OCR.
- **"Cuotas" vacías sin mensaje (2026-07-13):** un gasto con un único participante (compra individual, sin repartir) genera correctamente 0 filas en `debts` (el pagador no se debe a sí mismo), pero `app/pages/ledger/[id].vue` mostraba la tarjeta "Cuotas" en blanco sin explicación (`data.expense.debts` es `[]`, que es *truthy* en Vue, así que el `v-if` no distinguía "sin cuotas" de "hay cuotas"). Se añadió un mensaje explícito para el caso de array vacío.

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
- **Galería de fotos (post-hoc, 2026-07-13):** ideas y propuestas admiten fotos de referencia, reutilizando la tabla `media` (extendida con `ideaId`/`proposalId` nullable, mismo patrón polimórfico que `taskId`). `POST/GET /api/ideas/[id]/media`, `POST/GET /api/proposals/[id]/media` — mismo límite 10MB, magic bytes y URL firmada que el resto de subidas del proyecto. Decisión explícita: cualquier `admin`/`owner` puede subir (no solo el autor), a diferencia de otras acciones de gestión sobre la idea/propuesta.

## Derramas, tareas y evidencia fotográfica (Fase 7)

### Schema y modelos

- `server/db/schema/tasks.ts`: tabla `tasks` (título, descripción, `assigneeId`, `due_date`, prioridad, estado `pending|in_progress|completed`, `origin_proposal_id` nullable — referencia a `proposals.id`, auditada); reutilizable por tareas manuales además de las derivadas de propuestas.
- `server/db/schema/media.ts`: tabla `media` (repositorio centralizado compartido con Fase 8), con campos `owner_type` (`task`|`gallery`), `task_id` nullable, `media_type` (`before`|`after`|`general`), ruta en MinIO, autor, timestamp. Validación de archivos en cliente (máx 10 MB tras compresión, JPEG/PNG).
- Índices únicos parciales en DB como red de seguridad idempotente: `expenses_origin_proposal_unique` y `tasks_origin_proposal_unique` sobre `origin_proposal_id WHERE origin_proposal_id IS NOT NULL`, evitando duplicados por reintentos de aplicación.

### Flujo transaccional: de propuesta aprobada a derrama + tarea

Cuando se cierra una propuesta en estado `'approved'` (Fase 6), se ejecuta un flujo atómico de dos pasos:

1. **`closeProposalCore(tx: TxExecutor, input)`**: actualiza estado propuesta a `'closed'`, registra cierre en auditoría.
2. **`executeApprovedProposalCore(tx: TxExecutor, input)`**: crea derrama (expense tipo `'derrama'`, reparto entre **todos** los copropietarios activos via `debt-splitter` de Fase 3, acreedor = usuario sistema "Fondo Común" ya definido en Fase 3) + crea tarea de ejecución vinculada (`origin_proposal_id` = proposal.id), ambas dentro de la misma transacción.

Ambas funciones reciben un `TxExecutor` (parámetro, no abren su propia transacción) — esto permite componerlas en un único `db.transaction()` en `server/api/proposals/[id]/close.post.ts`. Si cualquiera falla, la transacción se revierte completamente (atomicidad garantizada); si se reintentan, los índices únicos parciales previenen duplicados de gasto/tarea.

Guard idempotente: se comprueba si el gasto con esa `origin_proposal_id` ya existe antes de crearlo; si existe, se devuelve el expense.id y task.id sin repetir.

### Patrón arquitectónico reutilizable: composición transaccional

La extracción de funciones `*Core(tx, input)` que reciben un `TxExecutor` permite que múltiples operaciones de negocio se ejecuten dentro de una sola transacción de base de datos cuando deben ser atómicas. Ejemplo:

```typescript
// server/api/proposals/[id]/close.post.ts
await db.transaction(async (tx) => {
  await closeProposalCore(tx, { proposalId: input.id });
  await executeApprovedProposalCore(tx, { proposalId: input.id, ... });
  // Si ambas lo completan, COMMIT. Si alguna falla, ROLLBACK total.
});
```

Patrón documentado en `server/db/client.ts` (tipo `TxExecutor`, métodos disponibles idénticos a `db`).

### CRUD de tareas y notificaciones

- `server/services/task-service.ts`: `createTask`, `updateTask`, `transitionState` (cambios de estado auditados).
- `server/api/tasks/index.post.ts`: crear tarea (con `assigneeId` opcional); enqueues notificación "nueva tarea asignada" vía `notification-service` (Fase 5) si hay asignado.
- `server/api/tasks/[id].patch.ts`: actualizar tarea; re-enqueues "tarea asignada" si `assigneeId` cambia.
- `server/api/tasks/[id]/media.post.ts`: subir fotos Antes/Después, comprimidas en cliente, validadas por magic bytes, almacenadas en MinIO vía `storage.ts`, insertadas en `media` con `task_id` y tipo etiquetado.
- Cambios de estado de tarea quedan auditados en `audit_log`.
- **UI de asignación (2026-07-13):** el backend ya soportaba `assigneeId` desde la Fase 7, pero la UI no lo exponía. Se añadió selector de asignado (cualquier admin/owner) al crear una tarea (`app/pages/tasks/index.vue`) y reasignación desde el detalle (`app/pages/tasks/[id].vue`) — cualquier admin/owner puede reasignar a cualquier otro admin/owner, no solo el creador (mismo RBAC que ya existía en `PATCH /api/tasks/[id]`, sin cambios de permisos, solo UI nueva).

### Autorización

- Solo `admin`/`owner` pueden crear, reasignar, transicionar o cerrar tareas (no hay RBAC granular por tarea — equipo de confianza pequeño, decisión de diseño explícita).
- Invitado: lectura agregada de tareas y fotos, sin acción; nunca ve desglose de deuda individual de la derrama (heredado de `canSeeIndividualDebt` de Fase 2).
- Las derramas se auditan como eventos de dominio (usuario/timestamp/cambio).

## Galería, calendario y exportación fiscal (Fase 8)

### Galería cronológica del inmueble

- Reutiliza la tabla `media` de Fase 7 con `owner_type='gallery'` (vs. `owner_type='task'` para fotos Antes/Después de tareas). No requiere modelo nuevo.
- Filtrable por rango de fechas vía query params `start`/`end`.
- Endpoints:
  - `GET /api/gallery` — lista fotos en orden cronológico.
  - `POST /api/gallery/upload` — subida de foto general, validada (10 MB tras compresión, JPEG/PNG), almacenada en MinIO, insertada con `task_id IS NULL`.
- Autorización: `admin`/`owner` crean, Invitado solo lectura (igual que tareas de Fase 7).

### Calendario de reservas

- `server/db/schema/reservations.ts`: tabla `reservations` (owner, `start_date`, `end_date`), con constraint de exclusión a nivel base de datos: `EXCLUDE USING gist ON (daterange(start_date, end_date, '[]'))` impide reservas solapadas.
- El rango es **inclusivo-inclusivo deliberadamente** (`'[]'`) para permitir reservar un único día; trade-off aceptado: dos reservas no pueden encadenar checkout/checkin el mismo día (se consideran solapadas).
- La prevención de solape ocurre solo en PostgreSQL, no en aplicación — Drizzle ORM 0.45.2 no expone un builder nativo para exclusion constraints, así que se añadió a mano en la migración SQL.
- Endpoints:
  - `POST /api/reservations` — crear reserva; rechaza solape con `{ statusCode: 409 }` si el constraint falla.
  - `GET /api/reservations` — listar reservas (solo propias si `owner`, todas si `admin`).
  - `DELETE /api/reservations/[id]` — cancelar (auditada).
- Flujo simple por orden de llegada, sin aprobación ni límites de noches.

### Exportación fiscal

- `server/services/export-service.ts`: consulta gastos/pagos por rango de fechas, aplica RBAC (Invitado ve solo agregados totales, `admin`/`owner` ven desglose por deudor).
- `server/services/export-formatters.ts`: funciones puras CSV/PDF, separadas de `export-service` para ser testeables sin variables de entorno de BD (patrón de testabilidad).
- Formatos:
  - CSV: columnas `fecha`, `concepto`, `monto`, `deudor` (vacío para Invitado). Mitigación de inyección de fórmulas (CWE-1236): descripciones que comienzan con `=`, `+`, `-`, `@` o tabulador se anteponan con apóstrofe.
  - PDF: tabla simple con cabecera "Libro contable" explícitamente no certificado (no es formato AEAT Modelo 347). Sub-líneas grises por deudor si el rol permite.
- Endpoints: `GET /api/export/csv?start=...&end=...`, `GET /api/export/pdf?start=...&end=...`.
- **Alcance limitado explícito:** documento de consulta simple, no formato fiscal regulatorio; requiere validación posterior con gestoría externa.

### Patrón transversal: manejo de errores PostgreSQL

**Bug descubierto en code review y verificado empíricamente:** drizzle-orm 0.45.2 (driver `node-postgres`) envuelve errores de Postgres en un `DrizzleQueryError` cuyo `.code` directamente **no existe** — el código real de error (`23505` unique_violation, `23P01` exclusion_violation, etc.) queda en `.cause.code`.

- `server/utils/pg-error.ts`: helper `getPgErrorCode(error)` que revisa primero `.code`, y si no existe, `.cause.code`.
- **TODA consulta futura que necesite distinguir un código de error PostgreSQL específico DEBE usar este helper**, no comparar `error.code` directamente.
- Aplicado en:
  - `server/services/reservation-service.ts` (Fase 8): catch de `23P01` (exclusion_violation) para devolver 409 en lugar de 500.
  - `server/services/proposal-service.ts` (Fase 6, retroactivamente): catch de `23505` (unique_violation) en `castVote` para devolver 409 en duplicados.

## Mejoras UX post-lanzamiento (2026-07-13)

Trabajo correctivo fuera del roadmap de 8 fases, en respuesta a feedback directo del usuario tras usar la app completa. Detalle: `plans/260713-0934-mejoras-ux-borrado-gastos/plan.md`.

- **Componentes de subida reutilizables**: `app/components/FilePicker.vue` (selector puro — dropzone + preview + validación cliente de tipo/tamaño vía `UFileUpload` de Nuxt UI v4.9, SIN subida automática, para formularios donde el archivo es un campo más) y `app/components/media/PhotoUpload.vue` (`FilePicker` + botón "Subir" + orquestación HTTP, FormData/POST, para el caso "seleccionar y subir ya"). Sustituyen los `<input type="file">` desnudos en tareas, galería, ideas, propuestas, comprobantes de pago, ticket de OCR y PDF de cotización — es decir, TODOS los puntos de subida de la app. Catálogo de referencia en `/dev/components` (solo Admin), con ejemplos de ambos componentes más botones/formularios/alertas.
- **Soft-delete + papelera de Admin (no toggle público)**: ideas/propuestas descartadas o canceladas quedan **ocultas para todos los roles sin excepción** (`GET /api/ideas`/`GET /api/proposals` filtran server-side por `status`, no solo en el frontend). Solo Admin las ve, en `/admin/trash` (`GET /api/admin/trash`, agrega ideas `discarded` + propuestas `cancelled` + tareas con `discardedAt` no nulo). Tareas ganaron la misma capacidad vía columna `discardedAt` (timestamp nullable, separada del `status` de workflow todo/in_progress/done para no romper el kanban). Desde la papelera, Admin puede además **borrar definitivamente** (`DELETE /api/{ideas,proposals,tasks}/[id]`, solo si el elemento ya está en estado descartado/cancelado, transaccional con `FOR UPDATE` para que auditoría y borrado sean atómicos).
- **Borrado de fotos individuales**: `DELETE /api/media/[id]` genérico (sirve para fotos de tarea, galería, idea o propuesta, ya que `media` es polimórfica). Permiso: quien subió la foto o Admin. Borra primero la fila de BD y después el objeto real en MinIO (orden elegido para que un fallo parcial deje como mucho un objeto huérfano invisible, no una foto fantasma en la UI).
- **Central de gastos** (`/dashboard`, `server/services/dashboard-service.ts`): deudas pendientes propias (con acción directa "marcar pagado" vía `MediaPhotoUpload` → `POST /api/debts/[id]/mark-paid`, mismo endpoint que `/ledger`), deudas a favor (con "Confirmar recepción" directo cuando `status='pending_confirmation'`), saldo neto destacado (`totalPendingAsCreditor - totalPendingAsDebtor`), historial de pagos confirmados filtrable por periodo (semana/mes/histórico, filtrado en cliente sobre `paidAsDebtor`/`paidAsCreditor` sin re-consultar el servidor), y totales agregados del fondo común por mes/trimestre/histórico. No introduce restricciones de RBAC nuevas: las deudas propias son inherentemente datos del propio usuario (no desglose de terceros) y los agregados ya eran visibles para todos los roles en `/export` y `/ledger`. Cada línea enlaza a `/ledger/[expenseId]` para ver el comprobante completo.
- **URLs de referencia** (`reference_links`, tabla polimórfica por `entityType`+`entityId` sin FK real cruzada, como `proposals.winningQuoteId`): ideas, propuestas y tareas admiten varios enlaces externos (TikTok, Facebook, imágenes, lo que sea), añadidos por cualquier admin/owner, abren en pestaña nueva (`target="_blank" rel="noopener noreferrer"`). Validación server-side restringida a esquemas `http://`/`https://` (zod `.url()` por sí solo no basta — acepta `javascript:`/`data:`). Componente `app/components/ReferenceLinksCard.vue`, servicio compartido `server/services/reference-link-service.ts` reutilizado por los 9 endpoints (3 por tipo de entidad).
- **Navegación**: enlace "← Volver" fijo (no `router.back()`) en las 4 pantallas de detalle (tarea, idea, propuesta, gasto) hacia su listado padre.
- **Confirmaciones y notificaciones (2026-07-13):** eliminados todos los `window.confirm()`/`window.alert()` nativos de la app. Toda acción destructiva (borrar foto, comentario, enlace, idea/propuesta/tarea) pasa por `app/components/ConfirmDialog.vue` + el composable `useConfirmDialog()` (`app/composables/useConfirmDialog.ts`), que envuelve `useOverlay()` de Nuxt UI — patrón oficial, promesa `boolean` que resuelve `true` solo si el usuario confirma. El patrón transitorio `errorMessage` + `<UAlert>` para feedback de acciones puntuales fue reemplazado en toda la app por `useToast()`: éxito (`color: 'success'`) en el camino feliz de cada mutación, `warning` para validaciones de formulario antes de la llamada de red, `error` para fallos de servidor/red. Los `UAlert` persistentes ligados al estado de una entidad (tarea descartada, vista agregada por RBAC, confianza de extracción OCR, enlace de invitación inválido, nota de formato fiscal) se mantienen — no son feedback de una acción, son estado permanente de la página. Convención para código nuevo: nunca usar `confirm()`/`alert()` nativos ni el patrón `errorMessage` ref; usar siempre `useConfirmDialog()` y `useToast()`.
- **Autor y votación en ideas/propuestas (2026-07-13):** nuevo helper `server/utils/user-names.ts` (`getUserNameMap`, sin restricción de rol propia — el llamador ya valida con `requireRole` antes) resuelve `authorId → nombre` server-side; se usa en los 4 endpoints GET de ideas/propuestas (listado y detalle) para devolver `authorName` ya resuelto, y también en los comentarios de idea. Reemplaza el patrón anterior de `app/pages/ideas/[id].vue`, que resolvía nombres llamando a `GET /api/expenses/participants` — endpoint restringido a `admin`/`owner`, así que para el rol `guest` fallaba en silencio (403 sin lanzar error) y solo mostraba IDs crudos. Listados y detalle muestran ahora "Por {nombre}"; si el rol no permite crear ideas/propuestas, se muestra un `UAlert` explicativo en vez de ocultar el formulario sin más. En el detalle de propuesta se añadió un badge "X de Y propietarios han votado" (`votedCount`/`totalEligibleVoters` en `GET /api/proposals/[id]`, recalculado en cada petición sobre el conjunto ACTUAL de `admin`/`owner` no baneados — no es un snapshot: si alguien vota y luego cambia de rol o es baneado, el contador puede descuadrarse temporalmente; se acepta como límite conocido, no bloqueante) y un texto fijo explicando las reglas de la votación (un voto por propietario, gana la más votada, admin decide en empate/cero votos). Tanto en ideas como en propuestas se añadió una nota bajo "Descartar"/"Cancelar" aclarando el flujo de 2 pasos ya existente (oculta para todos → solo Admin borra definitivamente desde la Papelera) — no se cambió el modelo de permisos, solo se explicó en pantalla.
- **Borrado de ideas promovidas y propuestas aprobadas (2026-07-14):** decisión explícita del usuario sobre dos casos que antes quedaban bloqueados para siempre. (1) Idea ya promovida: `server/api/ideas/[id]/status.patch.ts` ahora permite `promoted → discarded` (antes `promoted`/`discarded` eran ambos terminales sin salida) — el promote ya copió título/descripción a la propuesta al crearla, así que archivar la idea después no le quita nada. El borrado definitivo (`ideas/[id].delete.ts`) sigue bloqueado mientras exista una propuesta con `originIdeaId` apuntando a esa idea (FK real sin cascada en `governance.ts`, a propósito) — se comprueba y se devuelve un 400 explicativo en vez de dejar que Postgres lance una violación de FK cruda. (2) Propuesta aprobada: `proposals/[id].delete.ts` ahora también acepta `status === 'approved'`, pero SOLO si la derrama que generó al aprobarse (gasto tipo `derrama` + `debts` repartidas, `assessment-service.ts`) tiene TODAS sus deudas en `pending` — si algún propietario ya pagó o confirmó, se bloquea para siempre (400). El check bloquea con `FOR UPDATE` **todas** las filas de `debts` de esa derrama sin filtrar por estado antes de decidir si es seguro borrar — filtrar por estado en el propio `WHERE` del lock dejaría sin bloquear justo las filas `pending` que hace falta proteger, abriendo una ventana real donde un `markDebtPaid` concurrente (`expense-service.ts`) podría colarse entre el check y el borrado y perderse en la cascada; se verificó y corrigió tras una revisión de código que encontró exactamente ese caso. Al borrar una aprobada se elimina también la derrama (gasto+deudas en cascada vía FK), la tarea de ejecución generada junto a ella (`tasks.originProposalId`, sin cascada, se borra explícitamente antes que la propuesta) y los enlaces de referencia de ambas. Verificado extremo a extremo con datos reales: aprobar → generar derrama+tarea → borrar → confirmar en BD que propuesta/gasto/tarea/deudas/cotizaciones quedan en cero filas, y que una derrama con algún pago confirmado bloquea el borrado correctamente.
- **Galería con miniaturas y lightbox (2026-07-14):** ninguna pantalla pintaba imágenes inline — solo botones con la fecha que abrían la foto en pestaña nueva (`window.open`), pidiendo la URL firmada una por una al hacer click. Se creó `server/utils/media-urls.ts` (`resolveMediaUrls`, expiración 3600s en vez de los 300s por defecto de `getSignedUrl` — la galería se puede quedar abierta un rato) que resuelve TODAS las URLs de un lote de una vez; se usa en los 4 endpoints que listan media (`GET /api/gallery`, `GET /api/ideas/[id]`, `GET /api/proposals/[id]`, `GET /api/tasks/[id]`), sustituyendo los 4 endpoints por-click que quedaron sin uso y se borraron (`gallery/[id].get.ts` y los `.../media/[mediaId].get.ts` de ideas/propuestas/tareas). Nuevo componente `app/components/media/PhotoGallery.vue`: grid de miniaturas (`<img>` real, sin generación de thumbnails aparte — la propia imagen escalada por CSS) + lightbox (`UModal` con slot `#content`) con navegación prev/next entre todas las fotos de la galería. Sustituye el grid duplicado que existía en los 4 puntos con fotos de la app. `GET /api/gallery` limita a las 60 fotos más recientes (antes no tenía tope; cada foto ahora implica una llamada a MinIO para firmar su URL, así que una galería sin límite dispararía cientos de llamadas en cada carga con suficiente historial).
- **Compresión de imágenes al subir (2026-07-14):** no existía ningún compresor/redimensionador. Nuevo `app/utils/compress-image.ts` (Canvas nativo del navegador, sin librerías: `createImageBitmap` + reescalado a máx. 1920px de lado largo + recodificado a JPEG calidad 0.82, con relleno blanco antes de dibujar para que un PNG con transparencia no salga con fondo negro) se invoca en `app/components/media/PhotoUpload.vue` justo antes de subir, solo si el archivo es una imagen y pesa más de 300KB. Nueva prop `compress` (default `true`) permite desactivarlo por sitio de uso: se desactiva explícitamente en los comprobantes de pago (`dashboard.vue`, `ledger/[id].vue`, flujo `mark-paid`) porque son evidencia financiera donde la legibilidad exacta importa más que el tamaño — mismo criterio ya aplicado al ticket de OCR, que pasa por `FilePicker.vue` sin pasar nunca por este compresor.
- **Preparación de despliegue en Easypanel (2026-07-17):** no existía `Dockerfile`. Nuevo `Dockerfile` multi-stage (build con `pnpm build`, runtime con `pnpm install --prod` + `.output` de Nitro) — construido y arrancado localmente contra Postgres/MinIO reales para verificar el flujo completo, no solo revisado por lectura. Detalle completo, incluida la lista de env vars y el aviso crítico de que MinIO necesita dominio público (las URLs firmadas las abre el navegador del usuario, no el servidor), en `docs/deployment.md`. Cambios de código que salieron de esa verificación real, no hipotéticos:
  - `drizzle-kit` movido de `devDependencies` a `dependencies` — el contenedor migra el esquema al arrancar (`drizzle-kit migrate`) antes de levantar el servidor, y esa CLI necesita estar disponible en la imagen de producción, no solo en dev.
  - `pnpm-workspace.yaml`: `allowBuilds` (esbuild, @tailwindcss/oxide, etc.) pasado de `false` a `true` — sin esto, `pnpm install` fallaba en cualquier entorno no interactivo (CI, Docker) con `ERR_PNPM_IGNORED_BUILDS`.
  - `nuxt.config.ts`: quitada la regla `routeRules: { '/': { prerender: true } }`. El prerender de build arranca Nitro completo, incluidos sus plugins (`server/plugins/*`), que necesitan variables de entorno reales (`DATABASE_URL`, MinIO, etc.) — en un despliegue Docker esas variables solo existen en runtime, nunca en build, así que prerenderizar cualquier ruta rompía la construcción de la imagen. La home es contenido estático simple; no pierde nada relevante sirviéndose por SSR normal. Como defensa adicional (por si se reintroduce prerender de alguna ruta en el futuro), los 3 plugins de Nitro (`env-check.ts`, `seed-fondo-comun.ts`, `notification-dispatcher.ts`) ahora hacen `if (import.meta.prerender) return` al inicio.
  - `server/utils/auth.ts`: añadido `advanced.ipAddress.ipAddressHeaders: ['x-forwarded-for']` a la config de Better Auth — detectado en los logs del contenedor real (no algo hipotético): detrás del proxy de Easypanel (Traefik) la IP del cliente viaja en ese header, y sin esta config el rate-limiting de Better Auth cae a un único bucket compartido para todos los usuarios en vez de limitar por IP real.

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
