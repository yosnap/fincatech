---
phase: 4
title: "UI: movimientos y resumen de conciliación"
status: implemented
priority: P1
effort: "8h"
dependencies: [3]
---

# Phase 4: UI: movimientos y resumen de conciliación

## Overview
Página `app/pages/banco/index.vue`: resumen de conciliación arriba (saldo actual, saldo pre-compra, alertas) y listado completo de movimientos con saldo acumulado, filtros por período, alta con/sin justificante y adjunto posterior. Entrada de menú en el grupo Finanzas.

## Requirements
- Functional: lista con fecha/dirección/importe/descripción/categoría/justificante/saldo acumulado; filtros (pre-compra, post-compra, mes); alta y borrado (admin); adjuntar justificante después; ingresos externos con categoría.
- Non-functional: Nuxt UI v4 (patrón `ledger/index.vue`), paginación en cliente (UPagination, 8-10/pág.), archivos <1000 líneas fragmentando componentes, importes en céntimos → formateo €.

## Architecture

```
app/pages/banco/index.vue              // página: resumen + lista + filtros
app/components/bank/
  ReconciliationSummary.vue            // tarjetas: saldo actual, saldo pre-compra,
                                      // efectivo sin depositar, ingresos sin origen
  TransactionList.vue                  // tabla con saldo acumulado y badge justificante
  TransactionForm.vue                  // modal: fecha, dirección, importe, descripción,
                                      // categoría (si depósito externo), file opcional
  ProofAttach.vue                      // adjuntar justificante a movimiento existente
```

- Datos: `useFetch('/api/bank/transactions')` + `useFetch('/api/bank/summary')`; filtrado/orden/paginación en cliente (patrón libro contable).
- Filtro de período: pre-compra / post-compra / todos + selector de mes — usa `financeSettings.purchaseDate` de `/api/bank/settings`.
- Justificante: badge con 3 estados — presente (abre signed URL), ausente ("sin justificante"), y acción de adjuntar (modal `ProofAttach`, reutiliza `FilePicker`/`PhotoUpload` con `compress=false` como evidencia financiera).
- Alta: `TransactionForm` envía multipart (mismo flujo que `ExpenseForm`); admin only.
- Menú: `app/layouts/default.vue` → grupo Finanzas: "Cuenta bancaria" → `/banco`.

## Related Code Files
- Create: `app/pages/banco/index.vue`, `app/components/bank/ReconciliationSummary.vue`, `TransactionList.vue`, `TransactionForm.vue`, `ProofAttach.vue`
- Modify: `app/layouts/default.vue` (ítem de menú)
- Reutilizar: `app/components/FilePicker.vue`, `app/components/ConfirmDialog.vue`, `app/utils/` de formateo existente

## Implementation Steps
1. Página base con `useFetch` y layout de dos bloques (resumen + lista).
2. `ReconciliationSummary` con las 4 tarjetas y estados de alerta (efectivo pendiente > 0, ingresos sin origen > 0).
3. `TransactionList` con saldo acumulado, badges y paginación en cliente.
4. `TransactionForm` (multipart con file opcional; categoría condicional).
5. `ProofAttach` (adjuntar después).
6. Menú en `default.vue`.
7. Verificación manual en dev: crear movimiento sin ticket → lista; adjuntar ticket → badge; filtrar pre-compra.

## Success Criteria
- [x] El saldo acumulado se muestra por fila y cuadra con las tarjetas del resumen.
- [x] Puedo crear un movimiento sin justificante y adjuntarlo después desde la lista.
- [x] Filtro pre-compra muestra solo movimientos anteriores a la fecha de compra y el saldo pre-compra es coherente.
- [x] Alta de ingreso externo con categoría (Hacienda/Ayuntamiento/IVA/impuestos/otro).
- [x] Solo el admin ve acciones de alta/borrado.
- [x] Página funciona en móvil (~400px) y ningún archivo supera 1000 líneas.

## Risk Assessment
- La lista completa en cliente escala mal con años de movimientos — mismo trade-off aceptado en el libro contable; señal de rotura: >2-3k filas percibidas lentas → pasar a paginación server reutilizando el patrón de filtros ya existente.
- Estados de justificante dependen de `hasProof` desnormalizado; si un upload falla a mitad, la fila podría quedar `hasProof=false` con objeto en MinIO → limpiar objeto en el catch (patrón expenses).
