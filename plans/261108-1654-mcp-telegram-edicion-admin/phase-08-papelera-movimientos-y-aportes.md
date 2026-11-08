---
phase: 8
title: "Phase 8: Papelera de movimientos, aportes y gastos"
status: completed
priority: P1
effort: 14h
dependencies: [1]
---

# Phase 8: Papelera de movimientos, aportes y gastos

> Petición del usuario (2026-11-08): eliminar movimientos, aportes **y gastos** con borrado lógico y papelera, en lugar del borrado duro actual. Se ejecuta **justo después de la corrección de la fase 1 y antes de la hipoteca (fase 7)**, porque la hipoteca y el detector de duplicados deben ignorar lo que esté en la papelera.

## Goal
Eliminar un movimiento bancario, un aporte o un gasto lo manda a la papelera (no se pierde nada, tampoco el justificante); desde la papelera el admin puede restaurarlo o eliminarlo definitivamente.

## Diseño
1. **Columnas** `deleted_at timestamptz` y `deleted_by text` (FK users) en `bank_transactions`, `contributions` y `expenses` (las `debts` heredan el estado de su gasto; no llevan columna propia). Migración aditiva y nullable (compatible con rollback).
2. **Filtro único**: helper `notDeleted(table)` usado en todas las lecturas. Lista cerrada de consultas a revisar: `bank-service.ts` (saldo, listado, `getActiveMembers` no aplica), `contribution-service.ts` (grid, duplicados, comprobación de duplicado al crear, vinculación), `settlement-service.ts` (fondo común), `api/bank/summary.get.ts`, `api/bank/contributions/index.get.ts`, `api/bank/transactions/[id].get.ts`, `[id]/proof.post.ts`. Test: lo que está en la papelera no cuenta en saldo, fondo común, grid ni conciliación.
3. **Índice único de cuota** (`contributions_quota_unique`) pasa a `where type = 'quota' and deleted_at is null`, para poder volver a registrar el mes tras mandar una cuota a la papelera.
4. **Mandar a la papelera un movimiento** ~~desvincula los aportes~~ **[RT8-2] no desvincula**: `bankTransactionId` queda intacto y todas las lecturas tratan «vinculado a un movimiento en la papelera» como no vinculado (efectivo → pendiente de depósito; transferencia → alerta «aporte sin ingreso»). Restaurar no necesita el audit. El justificante **no** se borra.
5. **Restaurar**: comprueba conflictos (cuota del mismo miembro y mes ya registrada → 409 legible; aporte que ya se vinculó a otro movimiento → no se revincula y se avisa). Restaurar un movimiento revincula los aportes que sigan libres.
6. **Eliminar definitivamente** **[RT8-4]**: servicios nuevos `purgeTransaction` / `purgeContribution` / `purgeExpense` con `assertAdmin`, `FOR UPDATE` y 409 si la fila no está en la papelera; reutilizan el núcleo de borrado duro y auditan `*_purged`. (Corrección: `deleteContribution` hoy no limpia justificantes; el justificante de una transferencia cuelga de su movimiento y se limpia al purgar el movimiento.) Purgar un movimiento desvincula entonces sus aportes (que quedan sin vínculo).
7. **Permisos**: igual que hoy (movimientos: admin; aportes: admin o quien lo registró). La papelera y el borrado definitivo, solo admin.
8. Hipoteca (fase 7): el índice único de `mortgage_period` y los candidatos manuales también ignoran filas en la papelera.

## Files to Create / Modify
- Modify: `server/db/schema/bank.ts` + migración (`pnpm db:generate`)
- Create: `server/utils/soft-delete.ts` (`notDeleted`)
- Modify: `server/services/bank-service.ts`, `contribution-service.ts`, `settlement-service.ts` (filtro, `trash*`, `restore*`, `purge*`)
- Modify: `server/api/bank/transactions/[id].delete.ts`, `contributions/[id].delete.ts` (pasan a borrado lógico)
- Create: `server/api/bank/transactions/[id]/restore.post.ts`, `[id]/purge.delete.ts` e iguales para `contributions`
- Modify: `server/api/admin/trash.get.ts` (añadir movimientos y aportes) y `app/pages/admin/trash.vue` (secciones nuevas con «Restaurar» y «Eliminar definitivamente»; componente aparte si el fichero pasa de tamaño)
- Modify: textos de confirmación de borrado en `app/pages/banco/index.vue` y `contribuciones.vue` («Se moverá a la papelera»)
- Modify (fase 4): herramientas `eliminar_*` = papelera; nuevas `restaurar_*`; el borrado definitivo **no** se expone al bot ni al MCP (solo web)

## Tasks & Steps
1. **Backup de la BD** antes de migrar (copia semanal configurada en Easypanel; lanzar una manual justo antes).
2. Migración + helper + filtro en la lista cerrada de consultas; tests de `bank-core` / `settlement-core` con filas borradas.
3. Servicios `trash` / `restore` / `purge` con transacción y audit (`*_trashed`, `*_restored`, `*_purged`).
4. Endpoints y UI de papelera.

## Verification
- `pnpm test`, `pnpm lint`, `pnpm typecheck`.
- Local: mandar a la papelera un aporte duplicado → desaparece de listados, grid y saldo; aparece en la papelera; restaurarlo lo devuelve igual. Movimiento con aportes vinculados → a la papelera desvincula; restaurar revincula.
- Cuota en papelera → se puede volver a registrar ese mes; restaurar la antigua da 409 legible.

## Gastos (añadido 2026-11-08, decisión del usuario «sí para todo»)
- Se mantiene la regla de producto actual (`expense-service.ts:250-257`): un gasto con alguna cuota pagada o confirmada **no** se puede mandar a la papelera (409), igual que hoy no se puede borrar.
- Un gasto en la papelera saca sus deudas de liquidación, panel, exportación y estadísticas. Lista cerrada de consultas a filtrar: `settlement-service.ts`, `dashboard-service.ts`, `export-service.ts`, `assessment-service.ts`, `api/expenses/index.get.ts`, `api/expenses/[id].get.ts`, `api/debts/[id]/mark-paid.post.ts`, `api/debts/[id]/proof.get.ts`, `api/proposals/[id].delete.ts`.
- `markDebtPaid`, `confirmDebtReceipt` y la subida de justificante rechazan deudas de un gasto en la papelera (409 «El gasto está en la papelera»).
- Derrama de propuesta (`originProposalId`): un gasto de derrama en la papelera sigue contando para el guard idempotente de `executeApprovedProposal` (no se regenera otra derrama); el borrado de propuesta (`proposals/[id].delete.ts`) mantiene su comportamiento actual.
- Borrado definitivo de un gasto = `deleteExpense` actual (deudas en cascada, justificante y MinIO).

## Revisión rápida (2026-11-08) — incorporada
- **Aporte por transferencia con su ingreso auto-creado** (`isOwnAutoTransferDeposit`): mandarlo a la papelera manda también su movimiento, y restaurarlo restaura ambos. Si no, el saldo bancario seguiría contando un ingreso cuyo aporte ya no existe.
- **Restaurar un aporte cuyo movimiento se eliminó definitivamente**: se restaura sin vínculo (queda «pendiente de depósito» si era efectivo) y se avisa.
- **Detector de duplicados** (fase 1) y **comprobación al crear** ignoran filas en la papelera; la tarjeta de duplicados manda a la papelera, no borra.
- **Hipoteca** (fase 7): los candidatos para adoptar excluyen la papelera; un cargo automático en la papelera **no** se regenera (la marca de agua ya lo cubre) y restaurarlo respeta el índice único de `mortgage_period` (que pasa a `where deleted_at is null`).
- **Lectura por id** (`api/bank/transactions/[id].get.ts`, `api/expenses/[id].get.ts`): devuelven el elemento aunque esté en la papelera, con `deletedAt`, para que la papelera pueda mostrar el detalle; el resto de acciones sobre un elemento en la papelera responden 409.
- **Tests**: saldo, fondo común, liquidación y export con filas en la papelera; restaurar con conflicto de cuota; doble papelera / doble restauración idempotentes.

## Red Team fase 8 (2026-11-08) — 11 hallazgos aceptados; prevalece sobre lo anterior si contradice
- **[RT8-1] Crítico — deudas:** helper `liveDebts()` = `debts` con `innerJoin(expenses)` + `isNull(expenses.deletedAt)`, usado en **todas** las lecturas de `debts` (settlement, dashboard, export, `expenses/*`, `debts/*`, `assessment-service`). `computeSettlement` descarta toda deuda cuyo gasto no esté en `expenseMap` (hoy la pinta con descripción vacía, `settlement-core.ts:89-93`). Test: gasto en la papelera → liquidación y `byOwner` a 0. Verificar con `grep "from(debts)\|query.debts"` que no queda consumidor fuera.
- **[RT8-2] Crítico — vínculos:** ver Diseño §4 (no desvincular). `linkedCount` y el detector cuentan solo filas vivas.
- **[RT8-3] Arrastre aporte → ingreso (decisión del usuario: solo admin):** nueva columna `bank_transactions.auto_created_for_contribution_id` (uuid, nullable) rellenada en `createContribution` para transferencias; backfill único de los existentes con `isOwnAutoTransferDeposit`, revisado en local antes de producción. Si el actor es **admin**, aporte e ingreso marcado van juntos a la papelera y se restauran juntos (audit `bank_transaction_trashed` con `cascadeFrom`). Si es **propietario**, solo el aporte; aparece la alerta «ingreso sin aporte» para el admin. Esto sustituye al punto «Aporte por transferencia» de la revisión rápida.
- **[RT8-5] Bloqueos y estado dentro del servicio:** `assertNotTrashed(row)` bajo el `FOR UPDATE` de cada servicio que muta (`updateTransaction`, `updateContribution`, `link/unlinkContribution`, `updateExpenseParticipants`, `reassignExpenseCreator`, `markDebtPaid`, `confirmDebtReceipt`, `updateExpenseDate`, adjuntar justificante). `linkContribution` bloquea el movimiento destino (`FOR UPDATE`) y exige que esté vivo. `markDebtPaid` / `confirmDebtReceipt` bloquean el gasto (`FOR SHARE`) después de la deuda y rechazan si está en la papelera. Orden global de bloqueo: gasto → deudas → movimiento → aportes. `trash`/`restore`/`purge` comprueban el estado dentro del bloqueo. Tests de concurrencia por pareja (papelera vs pago, papelera vs vincular, restaurar vs purgar).
- **[RT8-6] Justificantes:** `proof.get.ts` de movimientos y gastos devuelven 404 a no-admin si el padre está en la papelera.
- **[RT8-7] Migración:** se retira «compatible con rollback». Documentar que antes de volver a una imagen anterior hay que vaciar la papelera (o las filas reaparecen). `DROP INDEX` + `CREATE UNIQUE INDEX` en la misma migración; probarla sobre una copia de la BD de producción en local.
- **[RT8-8] Restaurar:** reutiliza el criterio de duplicado de la fase 1 bajo el mismo `pg_advisory_xact_lock` (409 `possible_duplicate` con «Restaurar igualmente» solo en la web); rechaza aportes de miembros dados de baja; un gasto se restaura solo si sus participantes siguen activos (si no, 409 con la lista).
- **[RT8-9] Propuestas:** `proposals/[id].delete.ts` **sale de la lista de filtrado**: sigue encontrando la derrama aunque esté en la papelera, mantiene su guard de deudas no pendientes y, si estaba en la papelera, audita también `expense_purged` (`cascadeFrom: proposalId`). El guard idempotente de `executeApprovedProposal` lee **sin** filtro de papelera, con comentario y test.
- **[RT8-10] Hipoteca:** ver cambios en la fase 7 (índice con `deleted_at is null`; mes con cargo en la papelera = ocupado; la vista previa ofrece «restaurar» en vez de crear; purgar un cargo automático avisa de que ese mes no se regenerará).
- **[RT8-11] Ficheros completos para gastos:** `server/db/schema/expenses.ts`, `expense-service.ts`, `dashboard-service.ts`, `export-service.ts`, `export-formatters.ts`, `assessment-service.ts`, `api/expenses/[id].delete.ts`, `api/expenses/[id]/restore.post.ts`, `[id]/purge.delete.ts`, y `expenses` en `trash.get.ts`.
- **Caducidad (decisión del usuario):** nada se elimina solo; la papelera se vacía únicamente a mano.


## Estado de la implementación (2026-11-08)

Implementado completo, con las decisiones del red-team:

- **Migración `0016_young_master_mold.sql`:** columnas `deleted_at`/`deleted_by` en `bank_transactions`, `contributions` y `expenses`; `bank_transactions.auto_created_for_contribution_id` (+ índice); índice único de cuota recreado con `WHERE type='quota' AND deleted_at IS NULL`; backfill de los ingresos auto-creados con el mismo criterio que la heurística anterior; cabecera que documenta que la migración no admite rollback de la app con filas en la papelera (RT8-7).
- **Filtro único:** `server/utils/soft-delete.ts` con `notDeleted()`, `assertNotTrashed()`, `listLiveDebts()` (innerJoin con `expenses` vivos) y `listLiveExpenses()`. Aplicado a la lista cerrada de consultas del plan (bank-service, contribution-service, settlement-service, dashboard-service, export-service, `api/bank/*`, `api/expenses/*`, `api/debts/*`).
- **Servicios:** `trashTransaction`/`restoreTransaction`/`purgeTransaction` (bank-service), `trashContribution`/`restoreContribution`/`purgeContribution` (contribution-service), `trashExpense`/`restoreExpense`/`purgeExpense` (expense-service), con idempotencia, guards bajo `FOR UPDATE` y auditoría `*_trashed`/`*_restored`/`*_purged`.
- **RT8-3:** cascada aporte → ingreso auto-creado solo si el actor es Admin, dentro de la misma transacción; la heurística `isOwnAutoTransferDeposit` pasa a leer la columna (y sirve igual para sincronizar la edición del aporte).
- **RT8-1:** `computeSettlement` descarta deudas cuyo gasto no está vivo; todas las lecturas de deudas usan `liveDebts()`.
- **RT8-6:** los `proof.get.ts` de movimientos, gastos y cuotas devuelven 404 a no-Admin cuando el padre está en la papelera.
- **RT8-9:** el guard idempotente de `executeApprovedProposal` y `proposals/[id].delete.ts` leen sin filtro de papelera; si la derrama estaba en la papelera, se audita también `expense_purged` con `cascadeFrom`.
- **UI:** `/admin/trash` con secciones de movimientos, aportes y gastos (Restaurar / Eliminar definitivamente, «Restaurar igualmente» ante 409 `possible_duplicate`, avisos del servidor); textos de confirmación de `/banco`, `/banco/contribuciones` y `/ledger/[id]` pasan a «mover a la papelera».
- **Tests:** `server/services/soft-delete.integration.test.ts` (Postgres real, se activa con `TEST_DATABASE_URL`): grid y mes liberado tras la papelera de una cuota, 409 al restaurar sobre otra cuota del mismo mes, doble papelera/restauración idempotentes, cascada y restauración del ingreso espejo, movimiento fuera del listado, gasto fuera de la liquidación y guards de purga. Más el test unitario RT8-1 en `settlement-core.test.ts`.
- **Pendiente manual:** copia de seguridad de la BD de producción justo antes de desplegar (la migración es aditiva, pero el backfill y la recreación del índice único tocan datos reales).
