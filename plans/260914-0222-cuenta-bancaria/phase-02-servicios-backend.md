---
phase: 2
title: "Servicios backend y tests"
status: implemented
priority: P1
effort: "10h"
dependencies: [1]
---

# Phase 2: Servicios backend y tests

## Overview
Lógica de negocio en servicios con núcleo puro testeable (patrón `settlement-core.ts`): cálculo de saldos, conciliación aporte↔ingreso, estado mensual de cuotas y saldo con el fondo común.

## Requirements
- Functional: saldo acumulado por movimiento, saldo a fecha de compra, alertas de conciliación, grid mensual de cuotas (pagado/pendiente por miembro), saldo fondo común por miembro.
- Non-functional: núcleos puros sin acceso a DB con tests vitest; wrappers con Drizzle en `server/services/`.

## Architecture

**`server/services/bank-core.ts`** (puro, testeable):
- `computeRunningBalance(transactions)` → añade `balanceCentsAfter` a cada movimiento ordenado por fecha (estable: desempate por createdAt, id).
- `computeBalances(transactions, purchaseDate)` → `{ currentCents, prePurchaseCents }` (pre-compra = fecha < purchaseDate).
- `computeReconciliation(transactions, contributions)` → `{ cashPendingCents[]` (aportes `method='cash'` sin `bankTransactionId` — efectivo en mano del tesorero), `unmatchedDeposits[]` (depósitos sin aporte vinculado ni categoría externa) `}`.
- `computeFondoComun(contributions, transactions, activeMembers)` → por miembro: `contributedCents − totalWithdrawalsCents / N` (partes iguales, división entera con resto distribuido al primer miembro por orden alfabético de id — determinista). Los depósitos externos NO se acreditan a nadie.

**`server/services/bank-service.ts`** (wrapper DB):
- CRUD de `bank_transactions`; al borrar un movimiento, desvincular (`bankTransactionId = null`) los aportes que lo referencian (patrón de `expense-service` con proofs).
- `getSettings()` / `updateSettings()` (admin).

**`server/services/contribution-service.ts`**:
- CRUD de `contributions` con reglas: cuota (`type='quota'`) exige `period` y el índice único parcial impide duplicados miembro-mes; `registeredBy` = usuario de sesión; si difiere de `memberId`, requiere rol admin (regla opción B).
- **Adelanto multi-mes** (validación sesión 1): la alta de cuota acepta `months` (1-N); crea N filas — una por mes consecutivo — en una transacción, todas con misma fecha/método/vínculo bancario. Un pago parcial de un solo mes NO es una cuota: se registra como `extraordinary`.
- **Transferencia = ingreso automático** (validación sesión 1): si `method='transfer'`, el servicio crea el `bank_transaction` de ingreso ya vinculado (descripción auto: "Cuota {period} — {nombre}" / "Aporte {tipo} — {nombre}"), con el justificante (si viene) adjunto al MOVIMIENTO, no a la contribución. El efectivo no crea movimiento: queda "pendiente de depósito" hasta vinculación manual.
- `getMonthlyStatus(yearMonth)` → por cada miembro activo: `{ paid: boolean, contribution }` — pagado si existe fila de cuota del período (el importe siempre es la cuota completa).
- Vincular/desvincular aporte ↔ movimiento bancario (solo efectivo y pre-compra).

Tests (`server/services/*.test.ts`, vitest — mismo patrón que `settlement-core.test.ts`):
- Saldo acumulado con mezcla de ingresos/salidas y fechas desordenadas.
- Saldo pre-compra con movimientos justo en la fecha de compra (excluido: `<` estricto).
- Conciliación: aporte cash sin vincular, transferencia auto-vinculada, depósito externo no cuenta como "sin origen".
- Fondo común: partes iguales con resto, miembro sin aportes, N activos.
- Grid mensual: cuota pagada, pendiente, mes anterior a quotaStartMonth, **mes futuro pagado por adelantado**.
- Adelanto multi-mes: 3 meses → 3 filas consecutivas con el mismo `bankTransactionId`; duplicado miembro-mes rechazado.
- Transferencia: crea movimiento vinculado; borrar ese movimiento desvincula el aporte (vuelve a pendiente).

## Related Code Files
- Create: `server/services/bank-core.ts`, `server/services/bank-service.ts`, `server/services/contribution-service.ts`
- Create: `server/services/bank-core.test.ts`, `server/services/contribution-service.test.ts` (mínimo, reglas puras)
- Modify: nada existente.

## Implementation Steps
1. Escribir `bank-core.ts` con las cuatro funciones puras.
2. Tests de `bank-core` (los casos listados en arquitectura).
3. `bank-service.ts`: CRUD + desvinculación en borrado + settings.
4. `contribution-service.ts`: CRUD con validaciones + monthly status + vinculación.
5. `pnpm test` verde.

## Success Criteria
- [x] `bank-core.test.ts` cubre: saldos, pre-compra estricto, conciliación, fondo común con resto, grid mensual.
- [x] Borrar un movimiento bancario desvincula sus aportes (queda aporte vivo, movimiento fuera).
- [x] Registrar cuota por otro miembro siendo no-admin lanza error de RBAC a nivel de servicio/endpoint.
- [x] `pnpm test` pasa.

## Risk Assessment
- División entera de salidas/N deja un resto de céntimos: se asigna determinísticamente (orden por id) y se documenta en el test; señal de rotura si alguien espera reparto exacto → cambiar a `Math.round` por miembro con ajuste final.
- El adelanto multi-mes crea N filas atómicas: si la transacción falla a mitad no debe quedar fila huérfana ni movimiento sin cuota → todo en una Drizzle transaction; el test de multi-mes cubre el rollback.
- La auto-creación de ingreso en transferencia asume que el dinero llegó al banco en esa fecha; si el miembro registra la transferencia antes de que impacte, la fecha del movimiento es editable por el admin después.
