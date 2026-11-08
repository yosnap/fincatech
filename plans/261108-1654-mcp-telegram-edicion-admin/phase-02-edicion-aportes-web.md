---
phase: 2
title: "Phase 2: Edición de aportes en la web"
status: todo
priority: P1
effort: 7h
dependencies: [1]
---

# Phase 2: Edición de aportes en la web

## Goal
El admin edita cualquier campo de un aporte (fecha, notas, importe, tipo, período) desde la lista de aportes sin descuadrar la conciliación bancaria.

## Files to Create / Modify
- Modify: `server/services/contribution-service.ts` (`updateContribution` ampliada)
- Modify: `server/services/bank-core.ts` (regla pura «¿se puede recalcular el movimiento vinculado?»)
- Modify: `server/api/bank/contributions/[id].patch.ts` (schema con `amountCents`, `type`, `period`)
- Create: `app/components/bank/ContributionEditDialog.vue`
- Modify: `app/components/bank/ContributionList.vue` (botón «Editar», emit `edit`)
- Modify: `app/pages/banco/contribuciones.vue`
- Test: `server/services/bank-core.test.ts`

## Tasks & Steps
1. Ampliar `updateContribution` en transacción:
   - Valida tipo/período igual que `createContribution` (cuota requiere período válido; resto sin período).
   - Respeta el índice único de cuota (409 legible si choca).
   - Si el aporte está vinculado a un movimiento:
     - Movimiento con un único aporte vinculado y descripción auto-generada (transferencia) → actualizar importe, fecha y descripción (`buildTransferDescription`).
     - Movimiento compartido por varios aportes (adelanto) o vinculado manualmente → si cambia el importe, 409 «Desvincula el ingreso antes de cambiar el importe»; fecha/notas/tipo sí se permiten.
   - `writeAuditLog` con valores antes/después.
2. Regla pura de recálculo en `bank-core.ts` con tests (casos: único auto, adelanto, manual, efectivo sin vínculo).
3. Diálogo de edición (Nuxt UI, mismo estilo que `TransactionForm`): campos precargados, avisos de error del servidor como toast; sin `border-l-*`.
4. Botón «Editar» en `ContributionList` visible solo para admin; tras guardar, refrescar lista, grid y resumen.

## Verification
- `pnpm test`.
- Manual: cambiar fecha de aporte en efectivo; cambiar importe de una transferencia individual (el movimiento bancario cambia y el saldo cuadra); intentar cambiar importe de una cuota de adelanto → mensaje claro.
