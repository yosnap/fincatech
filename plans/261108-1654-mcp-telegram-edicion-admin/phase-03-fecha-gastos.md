---
phase: 3
title: "Phase 3: Fecha de gastos"
status: todo
priority: P1
effort: 5h
dependencies: []
---

# Phase 3: Fecha de gastos

## Goal
Los gastos tienen una fecha propia (cuándo se pagó), editable por el admin, distinta de la fecha de registro.

## Files to Create / Modify
- Modify: `server/db/schema/expenses.ts` (columna `expenseDate`)
- Create: migración en `drizzle/` vía `pnpm db:generate` (+ backfill `created_at::date`)
- Modify: `server/services/expense-service.ts` (`createExpense` acepta fecha; nueva `updateExpenseDate`)
- Create: `server/api/expenses/[id]/date.patch.ts` (admin)
- Modify: `server/api/expenses/index.post.ts`, `server/api/ocr/confirm*.post.ts` (fecha opcional; OCR ya extrae fecha del ticket si existe)
- Modify: listados/ordenación en `server/api/expenses/index.get.ts`, `export-service.ts`, `dashboard-service.ts` donde se use `createdAt` como fecha del gasto
- Modify: UI de alta y detalle de gasto (`app/pages/ledger/*`, `app/components/expense/*`)

## Tasks & Steps
1. **Backup de la BD** antes de migrar (regla del proyecto).
2. **[RT-11]** Columna `expense_date date not null default current_date` (compatible con la imagen anterior y con un rollback); backfill `update expenses set expense_date = (created_at at time zone 'Europe/Madrid')::date`. Verificar un gasto creado entre las 00:00 y las 02:00 de Madrid.
3. Alta: campo fecha (por defecto hoy); OCR rellena con la fecha del ticket si viene.
4. `updateExpenseDate` (admin) con audit log; no toca deudas ni snapshot.
5. Detalle del gasto: botón «Cambiar fecha» para admin.
6. Revisar con `grep createdAt` todos los usos que representan «fecha del gasto» y cambiarlos a `expenseDate` (listado, exportación CSV/PDF, estadísticas).

## Verification
- `pnpm db:migrate` sobre copia local; recuento de filas con `expense_date` nulo = 0.
- `pnpm test` (export-formatters) y `pnpm typecheck`.
- Manual: cambiar fecha de un gasto y verla en listado, estadísticas y CSV.

## Red Team (2026-11-08)
- **[RT-12]** Liquidación y panel: proyectar `expenseDate` en `SettlementLine` y `DebtSummaryItem` (join por `expenseId` ya cargado en `settlement-service.ts`) y ordenar por ella; añadir `server/services/settlement-core.ts`, `settlement-service.ts` y test en `settlement-core.test.ts`. Cambiar `getExportRows`, `api/export/csv.get.ts` y `dashboard-service.ts` a comparar strings `YYYY-MM-DD` (la columna `date` devuelve string). La plan.md decía «la liquidación ordena por ella»: ahora es tarea explícita.
- **[RT-13]** Fecha del OCR: validar con `isValidCalendarDate` en `api/ocr/confirm.post.ts` y `confirm-from-link.post.ts` (campo `date` nuevo); en `app/pages/expenses/new-from-ticket.vue` y `from-telegram.vue` mostrar la fecha editable, convertir `DD/MM/YYYY` a ISO y usar hoy (Madrid) si no es válida; rechazar fechas futuras.
- «Hoy» siempre en Europe/Madrid mediante una utilidad compartida (`server/utils/madrid-date.ts`), también usada por la hipoteca.
