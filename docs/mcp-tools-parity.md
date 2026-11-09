# Paridad herramientas MCP / bot ↔ web

Regla del producto: toda acción disponible en el servidor MCP o en el bot de Telegram tiene que poder hacerse también desde la web como Admin. Cuando se añade una herramienta a `server/tools/`, se añade aquí su fila con la pantalla equivalente; si no la tiene, la pantalla se crea antes de publicar la herramienta.

El borrado definitivo de la papelera solo existe en la web (`/admin/trash`) y no tiene herramienta, a propósito.

## Banco e hipoteca

| Herramienta | Tipo | Endpoint | Pantalla web |
|---|---|---|---|
| `resumen_banco` | read | GET `/api/bank/summary` | `/banco` |
| `listar_movimientos` | read | GET `/api/bank/transactions` | `/banco` |
| `crear_movimiento` | write | POST `/api/bank/transactions` | `/banco` → «Nuevo movimiento» (`TransactionForm`) |
| `editar_movimiento` | write | PATCH `/api/bank/transactions/:id` | `/banco` → editar movimiento (`TransactionForm`) |
| `eliminar_movimiento` | destructive | DELETE `/api/bank/transactions/:id` | `/banco` → «Mover a la papelera» |
| `restaurar_movimiento` | write | POST `/api/bank/transactions/:id/restore` | `/admin/trash` → «Restaurar» |
| `cuotas_pendientes` | read | GET `/api/bank/contributions/grid` | `/banco/contribuciones` → celdas «Pendiente» del grid |
| `ver_hipoteca` | read | GET `/api/bank/mortgage` | `/banco` → sección hipoteca (`MortgageSettings`) |
| `configurar_hipoteca` | destructive | POST `/api/bank/mortgage` | `/banco` → «Añadir tramo» |
| `listar_pagos_hipoteca_manuales` | read | GET `/api/bank/mortgage/backfill/preview` | `/banco` → «Rellenar meses» (`MortgageBackfillDialog`) |
| `rellenar_hipoteca` | destructive | POST `/api/bank/mortgage/backfill/confirm` | `/banco` → «Confirmar relleno» |

## Aportes

| Herramienta | Tipo | Endpoint | Pantalla web |
|---|---|---|---|
| `listar_aportes` | read | GET `/api/bank/contributions` | `/banco/contribuciones` |
| `crear_aporte` | write | POST `/api/bank/contributions` | `/banco/contribuciones` → formulario de aporte |
| `editar_aporte` | write | PATCH `/api/bank/contributions/:id` | `/banco/contribuciones` → «Editar» (`ContributionEditDialog`) |
| `eliminar_aporte` | destructive | DELETE `/api/bank/contributions/:id` | `/banco/contribuciones` → «Eliminar» |
| `restaurar_aporte` | write | POST `/api/bank/contributions/:id/restore` | `/admin/trash` → «Restaurar» |
| `vincular_aporte` | write | PATCH `/api/bank/contributions/:id` (`bankTransactionId`) | `/banco/contribuciones` → «Vincular depósito» (`LinkDepositDialog`) |
| `desvincular_aporte` | write | PATCH `/api/bank/contributions/:id` (`bankTransactionId: null`) | `/banco/contribuciones` → «Desvincular» |
| `listar_duplicados_aportes` | read | GET `/api/bank/contributions/duplicates` | `/banco/contribuciones` → `DuplicateContributionsCard` |

## Gastos, deudas y liquidación

| Herramienta | Tipo | Endpoint | Pantalla web |
|---|---|---|---|
| `listar_gastos` | read | GET `/api/expenses` | `/ledger` |
| `ver_gasto` | read | GET `/api/expenses/:id` | `/ledger/:id` |
| `cambiar_fecha_gasto` | write | PATCH `/api/expenses/:id/date` | `/ledger/:id` → «Cambiar fecha» |
| `cambiar_participantes_gasto` | write | PATCH `/api/expenses/:id/participants` | `/ledger/:id` → participantes |
| `eliminar_gasto` | destructive | DELETE `/api/expenses/:id` | `/ledger/:id` → «Eliminar gasto» |
| `restaurar_gasto` | write | POST `/api/expenses/:id/restore` | `/admin/trash` → «Restaurar» |
| `marcar_deuda_pagada` | write | POST `/api/debts/:id/mark-paid` (propia) o `/api/debts/:id/settle` (ajena, Admin) | `/ledger/:id` → «Marcar como pagado» / «Marcar cobrada en nombre del deudor»; `/dashboard` |
| `confirmar_cobro_deuda` | write | POST `/api/debts/:id/confirm` | `/ledger/:id` y `/dashboard` → «Confirmar recepción» |
| `ver_liquidacion` | read | GET `/api/settlement` | `/liquidacion` |
| `estadisticas` | read | GET `/api/dashboard/stats` | `/estadisticas` |

## Tareas, ideas, propuestas, reservas y miembros

| Herramienta | Tipo | Endpoint | Pantalla web |
|---|---|---|---|
| `listar_tareas` | read | GET `/api/tasks` | `/tasks` |
| `ver_tarea` | read | GET `/api/tasks/:id` | `/tasks/:id` |
| `crear_tarea` | write | POST `/api/tasks` | `/tasks` → «Nueva tarea» (título, descripción, asignado, prioridad, fecha límite) |
| `editar_tarea` | write | PATCH `/api/tasks/:id` | `/tasks/:id` → «Editar» (`TaskEditDialog`) y selector de asignado |
| `cambiar_estado_tarea` | write | PATCH `/api/tasks/:id/status` | `/tasks/:id` → botones de estado |
| `eliminar_tarea` | destructive | POST `/api/tasks/:id/discard` | `/tasks/:id` → «Descartar» |
| `listar_ideas` | read | GET `/api/ideas` | `/ideas` |
| `ver_idea` | read | GET `/api/ideas/:id` | `/ideas/:id` |
| `crear_idea` | write | POST `/api/ideas` | `/ideas` → formulario |
| `cambiar_estado_idea` | write | PATCH `/api/ideas/:id/status` | `/ideas/:id` → «En discusión» / «Descartar» |
| `listar_propuestas` | read | GET `/api/proposals` | `/proposals` |
| `ver_propuesta` | read | GET `/api/proposals/:id` | `/proposals/:id` |
| `cancelar_propuesta` | destructive | POST `/api/proposals/:id/cancel` | `/proposals/:id` → «Cancelar propuesta» |
| `listar_reservas` | read | GET `/api/reservations` | `/calendar` |
| `crear_reserva` | write | POST `/api/reservations` | `/calendar` → «Reservar» |
| `eliminar_reserva` | destructive | DELETE `/api/reservations/:id` | `/calendar` → «Cancelar reserva» |
| `listar_miembros` | read | GET `/api/members` | `/members` |
