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
2. Columna `expense_date date not null`; migración en dos pasos dentro del mismo SQL: añadir nullable → `update expenses set expense_date = created_at::date` → `set not null`.
3. Alta: campo fecha (por defecto hoy); OCR rellena con la fecha del ticket si viene.
4. `updateExpenseDate` (admin) con audit log; no toca deudas ni snapshot.
5. Detalle del gasto: botón «Cambiar fecha» para admin.
6. Revisar con `grep createdAt` todos los usos que representan «fecha del gasto» y cambiarlos a `expenseDate` (listado, exportación CSV/PDF, estadísticas).

## Verification
- `pnpm db:migrate` sobre copia local; recuento de filas con `expense_date` nulo = 0.
- `pnpm test` (export-formatters) y `pnpm typecheck`.
- Manual: cambiar fecha de un gasto y verla en listado, estadísticas y CSV.
