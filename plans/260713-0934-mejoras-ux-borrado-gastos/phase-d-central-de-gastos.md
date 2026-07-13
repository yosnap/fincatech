---
phase: D
title: "Central de gastos"
status: pending
priority: P1
effort: 4h
---

# Phase D: Central de gastos

## Context links
- Feedback usuario: "no hay una central de gastos en donde se diga lo que hay pendiente de pagar, lo que se ha pagado en el mes, en el trimestre, con un historial".
- Hoy `/ledger` (Fase 3) solo lista gastos en orden cronológico plano, sin agregación por deuda propia/ajena ni por periodo. `server/api/expenses/index.get.ts` ya aplica el RBAC de agregación para Invitado (`canSeeIndividualDebt`) — reutilizar el mismo criterio.
- Tablas relevantes: `expenses`, `debts` (`server/db/schema/expenses.ts`).

## Requirements
Nueva vista `/dashboard` (o `/gastos`, a definir nombre final en implementación) con 4 bloques, en una sola consulta al backend:
1. **Lo que debo (pendiente):** `debts` donde `debtorId = usuario actual` y `status IN ('pending', 'pending_confirmation')`, con importe, a quién y de qué gasto.
2. **Lo que me deben:** `debts` donde `creditorId = usuario actual` y `status != 'confirmed'`.
3. **Historial de pagos:** `debts` con `status = 'confirmed'` donde el usuario es debtor o creditor, agrupado por mes (y filtrable a trimestre/año en el frontend sobre los mismos datos), con importe total del periodo.
4. **Totales agregados del fondo común:** suma de `expenses.amountCents` por periodo (mes actual, trimestre actual, total histórico) — visible para todos los roles (es agregado, no desglose individual, coherente con RBAC ya usado en export/ledger). Para Invitado, este bloque reemplaza a los bloques 1-2 si no tiene deudas propias (un Invitado normalmente no es propietario y no tiene debts).

## Related code files
- Create: `server/services/dashboard-service.ts` (consultas de agregación, puras respecto a RBAC — reutiliza `canSeeIndividualDebt`)
- Create: `server/api/dashboard.get.ts` (o el nombre de endpoint que se decida)
- Create: `app/pages/dashboard.vue` (o `/gastos.vue`)
- Modify: `app/layouts/default.vue` (nuevo enlace de nav, considerar si reemplaza o complementa "Libro contable")

## Implementation Steps
1. `dashboard-service.ts`: función `getDashboardSummary(user)` que devuelve los 4 bloques con una o pocas queries (evitar N+1).
2. Endpoint que llama al servicio con `requireRole(event, ['admin','owner','guest'])`.
3. UI: tarjetas/tabla por bloque, filtro de periodo (mes actual / trimestre actual / histórico) aplicado en cliente sobre los datos ya agrupados por mes que devuelve el backend (evita re-fetch por cada cambio de filtro).
4. Añadir al nav.

## Tests / Validation
- curl como owner con deudas pendientes reales: verificar que aparecen en el bloque correcto con importes correctos (contrastar con `SELECT` directo en psql).
- curl como guest: verificar que NO ve desglose individual de otros, solo agregados.
- Verificar que el historial de pagos confirmados coincide con `debts.status='confirmed'` reales en BD.

## Risks / Rollback
- Riesgo bajo: es una vista de solo lectura nueva, no modifica ningún dato ni flujo existente. Revertir es simplemente quitar la página y el endpoint.

## Open questions (a resolver en implementación, no bloqueantes)
- Nombre final de ruta: `/dashboard` vs `/gastos` vs integrarlo como pestaña dentro de `/ledger` en vez de página nueva — decidir según cómo quede de recargada la navegación una vez implementado.
