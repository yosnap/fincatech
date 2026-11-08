---
phase: 8
title: "Phase 8: Papelera de movimientos, aportes y gastos"
status: todo
priority: P1
effort: 10h
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
4. **Mandar a la papelera un movimiento**: los aportes vinculados se desvinculan (igual que ahora) y sus ids se guardan en el audit (`unlinkedContributionIds`) para poder revincularlos al restaurar. El justificante **no** se borra.
5. **Restaurar**: comprueba conflictos (cuota del mismo miembro y mes ya registrada → 409 legible; aporte que ya se vinculó a otro movimiento → no se revincula y se avisa). Restaurar un movimiento revincula los aportes que sigan libres.
6. **Eliminar definitivamente**: solo desde la papelera, con confirmación; usa la lógica actual de borrado duro (`deleteTransaction` / `deleteContribution`, incluido limpiar el justificante en MinIO).
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

