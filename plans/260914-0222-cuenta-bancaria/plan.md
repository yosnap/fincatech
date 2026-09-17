---
title: "Cuenta bancaria: conciliación, contribuciones y fondo común"
description: "Sección nueva de finanzas: movimientos bancarios pre/post compra con justificantes opcionales, contribuciones de miembros (pre-compra, cuota mensual, extraordinarias), conciliación depósito↔aporte y saldo con el fondo común integrado en la liquidación."
status: completed
priority: P1
effort: 34h
branch: feat/v0.16.0
tags: [finanzas, banco, contribuciones, conciliacion, drizzle, minio, nuxt]
blockedBy: []
blocks: []
created: 2026-09-14
createdBy: "ck:plan"
source: brainstorm con usuario (sesión 2026-09-14)
---

# Cuenta bancaria: conciliación, contribuciones y fondo común

## Overview

Nueva sección "Cuenta bancaria" en el grupo Finanzas que espeja la cuenta bancaria real de la copropiedad: todos los ingresos y salidas (tanto anteriores como posteriores a la compra del inmueble), cada uno con justificante opcional subible en cualquier momento. El saldo **se calcula** sumando movimientos — nunca se introduce a mano — y debe coincidir con el saldo real del banco. Las contribuciones de miembros (aportes pre-compra históricos, cuota mensual fija desde 2026-08 y aportes extraordinarios) se concilian con los ingresos bancarios: el efectivo entregado al tesorero queda "pendiente de depósito" hasta vincularlo al ingreso real. Además, la liquidación gana una sección nueva con el "saldo con el fondo común" de cada miembro.

## Contrato brainstorm aceptado

| Decisión | Valor |
|---|---|
| Saldo bancario | Calculado (Σ ingresos − Σ salidas); sin entrada manual. También saldo a fecha de compra |
| Contribuciones | Pre-compra (histórico), cuota fija mensual desde 2026-08, extraordinarias |
| Registro de cuotas | Opción A: cada miembro registra la suya. Opción B: el admin registra por otro (queda marcado `registeredBy`) |
| Conciliación | Aporte en efectivo → `pendiente de depósito` hasta vincular al ingreso bancario. Alertas: ingresos sin aporte asociado y efectivo sin depositar |
| Ingresos externos | Depósitos ajenos a miembros: devolución Hacienda/Ayuntamiento/impuestos, compensación IVA, otros. Con categoría propia. **No se acreditan a ningún miembro** en el fondo común |
| Crédito en liquidación | "Saldo con el fondo común" por miembro: `aportado − salidas/N` (partes iguales entre miembros activos). Sección additive, sin tocar las deudas pairwise |
| Tesorero | El rol admin (sin cambios de RBAC) |
| Configuración | Global: fecha de compra, importe de cuota, mes de inicio |
| Cuenta | Única, sin API bancaria |

## Decisiones de diseño

1. **Tablas propias, no `expenses`.** Un apunte bancario no arrastra `participantSnapshot`/`debts`; semántica distinta. Nueva tabla `bank_transactions`.
2. **Ingresos externos**: depósitos con `category` (`hacienda`|`ayuntamiento`|`impuestos`|`iva`|`otro`) y sin `contributions` vinculadas. En el fondo común no se acreditan a nadie: el bote común crece, el saldo por miembro no cambia.
3. **Fondo común (fórmula)**: `saldo_i = Σ contribuciones_i − (Σ salidas / N)` donde N = miembros activos (owner/admin, no dados de baja). `Σ saldos_i = fondo total − ingresos externos`. Los ingresos externos benefician a todos implícitamente al quedar en el bote.
4. **Justificantes**: se reutiliza `payment_proofs` (polimórfica) ampliando `entityType` con `'bank_transaction'`, y `storage.ts` MinIO tal cual (magic bytes + whitelist jpeg/png/pdf, 10MB, URLs firmadas). `hasProof` booleano derivado para listados baratos.
5. **Períodos**: pre-compra = movimientos con fecha < `financeSettings.purchaseDate`. La fecha de compra corta el histórico del período de hipoteca.
6. **Visibilidad Invitado**: ve movimientos y saldo (información comunal) pero NO el grid de contribuciones por miembro (desglose individual, mismo criterio que `canSeeIndividualDebt`). Sus propias contribuciones sí.
7. **Adelanto de cuotas** *(validación sesión 1)*: una cuota = una fila por miembro y mes (índice único parcial), pero el formulario admite pagar N meses por adelantado → crea N filas en una transacción, todas con la misma fecha/método/vínculo bancario. Un mes parcial NO es una cuota: se registra como aporte extraordinario.
8. **Transferencia = ingreso automático** *(validación sesión 1)*: al registrar un aporte `method='transfer'` se crea automáticamente el movimiento bancario de ingreso ya vinculado (descripción auto, p. ej. "Cuota 2026-09 — Ana"). El justificante de una transferencia va al **movimiento** (es el ticket bancario); un aporte en efectivo no lleva justificante hasta su depósito.
9. **Borrado duro** *(validación sesión 1)*: movimientos y contribuciones se borran definitivamente, solo admin (patrón expenses), desvinculando/borrando en cascada lógica lo asociado.

## Non-goals

- Integración bancaria (open banking) o importación de extractos.
- Multi-cuenta o multi-moneda.
- Enlace automático salidas ↔ libro contable de gastos (registro manual independiente).
- Tabla `property` (configuración global de una sola fila).
- Rol "tesorero" nuevo.
- OCR automático de justificantes bancarios (la infraestructura existe; si se pide, fase posterior).

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Movimientos bancarios CRUD con justificante opcional (subible después) y saldo calculado | P1 |
| 2 | Contribuciones: pre-compra, cuota mensual, extraordinarias, con registro propio o por admin | P1 |
| 3 | Conciliación: vinculación aporte↔ingreso, alertas de descuadre | P1 |
| 4 | Saldo con el fondo común en la liquidación (partes iguales) | P1 |
| 5 | Ingresos externos categorizados (Hacienda, Ayuntamiento, IVA…) | P1 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Esquema de BD y migración](./phase-01-start.md) | Implemented (rama feat/v0.16.0, pendiente de commit) |
| 2 | [Servicios backend y tests](./phase-02-servicios-backend.md) | Implemented (rama feat/v0.16.0, pendiente de commit) |
| 3 | [Endpoints de API](./phase-03-api-endpoints.md) | Implemented (rama feat/v0.16.0, pendiente de commit) |
| 4 | [UI: movimientos y resumen de conciliación](./phase-04-ui-movimientos.md) | Implemented (rama feat/v0.16.0, pendiente de commit) |
| 5 | [UI: contribuciones y liquidación](./phase-05-ui-contribuciones-liquidacion.md) | Implemented (rama feat/v0.16.0, pendiente de commit) |

## Success Criteria

- [x] Puedo crear un movimiento bancario (ingreso/salida, pre o post compra) con o sin justificante, y adjuntar el justificante después.
- [x] El saldo actual y el saldo a fecha de compra se calculan y se muestran; no existe ningún campo de saldo manual.
- [x] Cada miembro registra su cuota mensual; el admin puede registrar por otro y queda registrado quién lo hizo (`registeredBy`).
- [x] La vista mensual de cuotas muestra quién pagó y quién falta, desde 2026-08 hasta el mes actual.
- [x] Un aporte en efectivo queda "pendiente de depósito" hasta vincularlo a un ingreso bancario; el resumen alerta de efectivo sin depositar e ingresos sin aporte asociado.
- [x] Puedo registrar ingresos externos con categoría (Hacienda, Ayuntamiento, IVA, impuestos, otro).
- [x] La liquidación muestra el saldo con el fondo común de cada miembro (aportado − salidas/N) sin alterar las deudas pairwise existentes.
- [x] El Invitado no ve el desglose de contribuciones por miembro.
- [x] `pnpm test`, typecheck y build pasan; migración aplicada con backup previo.

## Related Code Files (resumen)

- Create: `server/db/schema/bank.ts`, `server/services/bank-core.ts`, `server/services/bank-service.ts`, `server/services/contribution-service.ts`, `server/api/bank/**`, `app/pages/banco/index.vue`, `app/pages/banco/contribuciones.vue`, `app/components/bank/**`
- Modify: `server/db/schema/index.ts`, `app/layouts/default.vue`, `app/pages/liquidacion.vue`, `server/api/settlement/index.get.ts` (o su servicio), `server/services/settlement-service.ts`

## Risk Assessment

- **Cambio de membresía**: la fórmula de partes iguales usa N fijo (miembros activos actuales). Si un miembro entra/sale a mitad de período, el reparto histórico no se recalcula por fecha. Señal de rotura: queja por reparto injusto → migrar a reparto por movimiento según miembros activos en su fecha.
- **Doble registro post-compra**: un gasto pagado desde la cuenta puede existir en el libro contable Y como salida bancaria (decisión aceptada: registros independientes). Riesgo de confusión al leer totales → la UI etiqueta claramente cada sección.
- **Borrado de movimientos vinculados**: `contributions.bankTransactionId` sin FK dura (patrón polimórfico existente); al borrar un movimiento hay que desvincular sus aportes en el servicio (igual que hace `expense-service` con proofs).

## Unresolved Questions

Ninguna — todas las decisiones de producto se cerraron en el brainstorm (ver Contrato) y en la Validación sesión 1.

## Validation Log

### Session 1 — 2026-09-14
**Trigger:** `/ak:plan validate` tras creación del plan (elección del usuario en el handoff)
**Questions asked:** 4

#### Verification Results
- **Tier:** Full (5 fases) — muestreo de claims load-bearing
- **Claims checked:** 16
- **Verified:** 16 | **Failed:** 0 | **Unverified:** 0
- Verificados: `storage.ts` (uploadFile/getSignedUrl/deleteFile/objectExists/checkConnection), `rbac.ts` (requireRole/canSeeIndividualDebt), `payment_proofs` polimórfica (objectName/uploadedBy/entityType), patrón multipart+`matchesDeclaredType` en `expenses/index.post.ts`, grupo Finanzas en `app/layouts/default.vue`, páginas `liquidacion.vue`/`ledger/index.vue` con UPagination, scripts `db:generate`/`db:migrate`/`test`, siguiente migración = 0015, componentes FilePicker/PhotoUpload/ConfirmDialog, settlement (core+service+endpoint+test), roles text en `users`.

#### Questions & Answers

1. **[Assumptions]** ¿La cuota mensual se registra como un único pago por miembro y mes, o puede dividirse en varios pagos parciales?
   - Options: Una cuota por mes | Permitir pagos parciales
   - **Answer:** Custom: "Un miembro también puede pagar por ejemplo 3 meses por adelantado"
   - **Rationale:** Cambia el modelo: una fila por miembro-mes (índice único parcial) + alta multi-mes transaccional (adelanto). Pagos parciales de un mes no soportados (usar aporte extraordinario).
2. **[Architecture]** Cuando un miembro registra un aporte por transferencia, ¿el ingreso bancario se vincula manualmente o se crea automáticamente?
   - Options: Vinculación manual siempre | Auto-crear ingreso
   - **Answer:** Auto-crear ingreso
   - **Rationale:** Elimina un paso en el flujo mensual frecuente (transferencia). El efectivo mantiene el flujo manual con "pendiente de depósito".
3. **[Tradeoffs]** ¿Borrado de movimientos y contribuciones duro o soft-delete con papelera?
   - Options: Borrado duro, solo admin (Recommended) | Soft-delete con papelera
   - **Answer:** Borrado duro, solo admin (Recommended)
   - **Rationale:** Coherente con el patrón de gastos; evita duplicar esquema y complica menos los saldos.
4. **[Risks]** Para el reparto a partes iguales de las salidas, ¿N son los miembros activos actuales o los activos en la fecha de cada salida?
   - Options: N = activos actuales (Recommended) | N por fecha de cada salida
   - **Answer:** N = activos actuales (Recommended)
   - **Rationale:** Sin histórico de altas/bajas; se documenta el riesgo si cambia la membresía.

#### Confirmed Decisions
- Cuotas: una fila por miembro-mes con pago multi-mes (adelanto) transaccional.
- Transferencia: auto-crea el movimiento de ingreso vinculado; justificante va al movimiento.
- Borrado duro solo admin.
- Fondo común: N = miembros activos actuales.

#### Action Items
- [x] Propagar adelanto de cuotas a fases 1 (índice único parcial), 2 (servicio + tests) y 5 (formulario multi-mes).
- [x] Propagar auto-creación de ingreso a fases 2 (servicio + tests), 3 (endpoint) y 5 (formulario).
- [x] Justificantes: file opcional SOLO para transferencia (va al movimiento); quitar file genérico del aporte en efectivo.

#### Impact on Phases
- Phase 1: índice único parcial (member_id, period) WHERE type='quota'.
- Phase 2: `contribution-service` (alta multi-mes, auto-ingreso en transferencia, sin duplicados) y `bank-core` (tests actualizados).
- Phase 3: `contributions/index.post` acepta `months`; `summary` sin cambios (ingresos auto-creados ya quedan vinculados).
- Phase 5: `ContributionForm` con selector de meses y file condicional; grid admite meses futuros pagados por adelantado.

### Whole-Plan Consistency Sweep
- Files reread: plan.md, phase-01-start.md, phase-02-servicios-backend.md, phase-03-api-endpoints.md, phase-04-ui-movimientos.md, phase-05-ui-contribuciones-liquidacion.md
- Decision deltas checked: 4 (adelanto multi-mes, auto-ingreso transferencia, borrado duro, N activos actuales)
- Reconciled stale references: 5 (duplicado cuota→multi-mes en phase-02 risk; "file opcional" genérico→condicional en phase-03/05; estados del grid "parcial"→"adelantada" en phase-05 ×3: arquitectura, requirements, success criteria; justificante de pre-compra/extraordinarias → solo vía movimiento)
- Unresolved contradictions: 0
- Grep de verificación: sin apariciones restantes de "pagado/parcial" ni "file opcional" en contexto de contribuciones (los "file opcional" de phase-04 corresponden a TransactionForm de movimientos, que es correcto).

