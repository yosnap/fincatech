---
phase: 5
title: "UI: contribuciones y liquidación"
status: implemented
priority: P1
effort: "6h"
dependencies: [3, 4]
---

# Phase 5: UI: contribuciones y liquidación

## Overview
Página `app/pages/banco/contribuciones.vue` con el grid mensual de cuotas, aportes pre-compra y extraordinarios, vinculación a depósitos; y la nueva sección "Saldo con el fondo común" en `app/pages/liquidacion.vue`.

## Requirements
- Functional: grid miembro×mes (pagado/pendiente/adelantada) desde 2026-08; registro de cuota propia (opción A) y por admin (opción B, visible quién registró), con adelanto multi-mes; aportes extraordinarios y pre-compra (justificante solo vía transferencia — va al movimiento — o vía depósito vinculado); vincular aporte en efectivo a su depósito bancario.
- Non-functional: Invitado solo ve sus propias contribuciones (sin grid por miembro); liquidación additive sin romper la vista actual; archivos <1000 líneas.

## Architecture

```
app/pages/banco/contribuciones.vue    // 3 pestañas: Cuotas mensuales | Pre-compra | Extraordinarias
app/components/bank/
  MonthlyQuotaGrid.vue                // filas=miembros, columnas=meses (desde quotaStartMonth),
                                      // celda: pagado/pendiente/adelantada; clic → registrar
  ContributionForm.vue                // modal: miembro (admin) o yo, tipo, importe, período,
                                      // método (cash/transfer), fecha, meses 1-N (solo cuota,
                                      // adelanto), file SOLO si transfer (va al movimiento)
  ContributionList.vue                // listado con estado de depósito y acción de vincular
  LinkDepositDialog.vue               // admin: vincula aporte → ingreso bancario existente
app/pages/liquidacion.vue             // + sección "Saldo con el fondo común" (tarjetas por
                                      //   miembro: aportado, parte de salidas, saldo)
```

- Cuotas: cada celda del grid usa `getMonthlyStatus`; los meses FUTUROS pueden aparecer pagados (adelanto multi-mes — la celda muestra "adelantada"); el Invitado no ve el grid (solo su propia fila/lista).
- Opción B: al abrir `ContributionForm` como admin, el selector de miembro permite elegir a otro; la lista muestra "registrado por {name}" cuando `registeredBy ≠ memberId`.
- Vinculación: `LinkDepositDialog` lista depósitos sin aporte vinculado; al vincular, el aporte pasa de "pendiente de depósito" a "depositado".
- Liquidación: bloque nuevo bajo las deudas pairwise usando `settlement.fondoComun`; explica la fórmula (`aportado − salidas/N`) en una línea de ayuda.
- Menú: "Contribuciones" como segunda página dentro de "Cuenta bancaria" (o sub-item del grupo Finanzas, según el patrón de navegación existente).

## Related Code Files
- Create: `app/pages/banco/contribuciones.vue`, `app/components/bank/MonthlyQuotaGrid.vue`, `ContributionForm.vue`, `ContributionList.vue`, `LinkDepositDialog.vue`
- Modify: `app/pages/liquidacion.vue`, `app/layouts/default.vue` (si el menú necesita sub-item)

## Implementation Steps
1. Página con pestañas y carga de contribuciones + settings.
2. `MonthlyQuotaGrid` con estados de celda y clic para registrar cuota.
3. `ContributionForm` (multipart, self/admin, tipos de aporte).
4. `ContributionList` + `LinkDepositDialog` (vinculación).
5. Sección fondo común en `liquidacion.vue`.
6. Ajuste de menú y verificación manual completa del flujo: registrar cuota → verificar saldo → vincular depósito → ver liquidación.

## Success Criteria
- [x] El grid muestra todos los meses desde 2026-08 y el estado de cada miembro (pagado/pendiente/adelantada); un adelanto de 3 meses marca los 3 meses.
- [x] Un miembro registra su cuota; el admin registra la de otro y se ve "registrado por…".
- [x] Un aporte en efectivo aparece "pendiente de depósito" hasta vincularlo; luego "depositado".
- [x] La liquidación muestra el saldo con el fondo común por miembro sin alterar las deudas pairwise.
- [x] El Invitado ve sus contribuciones pero no el grid ni el fondo común de otros.
- [x] `pnpm test`, typecheck y build pasan; flujo manual completo verificado en dev.

## Risk Assessment
- El grid miembro×mes crece con el tiempo (columnas por mes): a partir de ~24 meses requiere scroll horizontal acotado (`overflow-x` en su contenedor, permitido en tablas).
- La sección nueva en `liquidacion.vue` puede llevar el archivo cerca de 1000 líneas → extraer `app/components/bank/FondoComunSection.vue` si supera el límite.
