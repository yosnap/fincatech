---
phase: 8
title: "Phase 8: Papelera de movimientos y aportes"
status: todo
priority: P1
effort: 6h
dependencies: [1]
---

# Phase 8: Papelera de movimientos y aportes

> Petición del usuario (2026-11-08): eliminar movimientos y aportes con borrado lógico y papelera, en lugar del borrado duro actual. Se ejecuta **justo después de la corrección de la fase 1 y antes de la hipoteca (fase 7)**, porque la hipoteca y el detector de duplicados deben ignorar lo que esté en la papelera.

## Goal
Eliminar un movimiento bancario o un aporte lo manda a la papelera (no se pierde nada, tampoco el justificante); desde la papelera el admin puede restaurarlo o eliminarlo definitivamente.

## Diseño
1. **Columnas** `deleted_at timestamptz` y `deleted_by text` (FK users) en `bank_transactions` y `contributions`. Migración aditiva y nullable (compatible con rollback).
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
