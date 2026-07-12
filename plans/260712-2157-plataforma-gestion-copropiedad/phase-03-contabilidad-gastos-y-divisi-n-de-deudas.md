---
phase: 3
title: "Contabilidad, gastos y división de deudas"
status: pending
priority: P1
effort: 16h
dependencies: [2]
roadmap: "F1 · MVP financiero"
---

# Phase 3: Contabilidad, gastos y división de deudas

## Context links
- PRD §4.1 (captura), §4.2 (contabilidad, deuda, pago), §5 (integridad transaccional) — `docs/prd.md`
- Decisiones de pago — `plans/reports/analisis-huecos-260712-1628-prd-gestion-copropiedad-report.md`
- ACID/SSI PostgreSQL — `research/researcher-01-stack-report.md`

## Overview
- **Fecha:** 2026-07-12
- **Descripción:** Núcleo financiero (MVP): registro de gastos manuales y recibos bancarios, cálculo de deudas N-1 dentro de transacciones, ciclo de estados del gasto, y flujo de comprobante + confirmación dual de pago (Admin o acreedor original). Sin pasarela: la app solo registra y concilia.
- **Prioridad:** P1
- **Estado de implementación:** Pendiente
- **Estado de revisión:** No revisado

## Key Insights
- **Corazón del producto y punto de máximo riesgo:** un cálculo de deuda inconsistente destruye la confianza entre copropietarios. Toda escritura de deuda va en transacción explícita.
- División N-1: quien sube el gasto ya pagó; se reparte entre los demás N-1. Con importe indivisible surgen residuos de céntimos → definir política determinista de redondeo (último deudor absorbe el residuo) para que Σ cuotas == importe exacto.
- Estados: `Pendiente → Pago Parcial → Liquidado`. Recibo bancario entra como `Liquidado en origen` generando deudas cruzadas al instante.
- **Confirmación dual (carrera):** Admin O acreedor pueden confirmar. Decisión de diseño técnica a fijar: "primero en confirmar gana" con guard idempotente (una cuota no puede pasar dos veces a `Confirmado`). Bloqueo por fila (`SELECT ... FOR UPDATE`) sobre la cuota.
- Comprobante obligatorio al marcar "Pagado" → estado intermedio `Pendiente de Confirmación`.
- "N" (número de copropietarios) puede cambiar (altas/bajas). La división se congela por gasto en el momento de creación (snapshot de participantes + porcentajes), no se recalcula retroactivamente.
- **Acreedor no siempre es un propietario:** la Fase 7 necesita repartir una derrama entre TODOS (N, no N-1) contra un acreedor "fondo común" (nadie adelantó el dinero aún). Modelar esto AQUÍ, no en Fase 7: `debts.acreedor_id` referencia `users.id` incluyendo una fila especial de tipo sistema (rol `fondo` o `system`, no autenticable) en vez de un campo nullable o una tabla paralela — evita romper `FOR UPDATE`/RBAC que ya asumen `acreedor_id → users`.

## Requirements
- **Funcional:** crear gasto manual (con/sin comprobante → marca "Sin Comprobante"); registrar recibo bancario liquidado en origen; ver estado de cuenta individual (Propietario) y agregado (Invitado); marcar cuota pagada con comprobante; confirmar recepción (Admin o acreedor).
- **No funcional:** todo cálculo/actualización de deuda en transacción; idempotencia en confirmaciones; auditoría de cada movimiento; consistencia Σ cuotas == importe.

## Architecture
```
createExpense(actor, importe, participantes[]) ── TX BEGIN
  ├ insert expense (snapshot % participación)
  ├ calcula cuotas N-1 (redondeo determinista, residuo al último)
  ├ insert debts (deudor → acreedor=actor)
  ├ insert audit_log
  └ COMMIT
markPaid(cuota, comprobante) → estado 'pendiente_confirmacion' (comprobante obligatorio)
confirmReceipt(actor∈{admin,acreedor}, cuota) ── TX BEGIN
  ├ SELECT cuota FOR UPDATE (evita doble confirmación)
  ├ if ya confirmada → no-op idempotente
  ├ estado→'confirmado'; recalcula estado del gasto (Parcial/Liquidado)
  ├ insert audit_log (actor+timestamp)
  └ COMMIT
```
- Importes en **enteros de céntimos** (nunca float) para evitar errores de redondeo.
- Nivel de aislamiento: `SERIALIZABLE` (o `REPEATABLE READ` + `FOR UPDATE`) en confirmaciones concurrentes; retry en `serialization_failure`.

## Related code files
- Create: `server/db/schema/expenses.ts` (expenses, debts, payment_proofs)
- Modify: `server/db/schema/users.ts` (seed de usuario sistema "fondo común", rol `fondo`, no autenticable) — coordinar con Fase 2
- Create: `server/services/debt-splitter.ts` (cálculo N-1 + redondeo determinista, puro/testeable)
- Create: `server/services/expense-service.ts` (createExpense/markPaid/confirmReceipt en TX)
- Create: `server/api/expenses/*` (crear, listar, detalle)
- Create: `server/api/debts/[markPaid|confirm].post.ts`
- Create: `app/pages/ledger/*` (libro contable, mi estado de cuenta)
- Create: `app/components/expense/*` (form manual, subida comprobante)
- Modify: `server/utils/rbac.ts` (agregados para guest en vistas de ledger)

## Implementation Steps
1. Schema: `expenses` (importe_centimos, estado, tipo manual|bancario, sin_comprobante bool, snapshot participantes), `debts` (deudor, acreedor, cuota_centimos, estado), `payment_proofs` (archivo, tipo).
2. `debt-splitter.ts` **puro**: dado importe+participantes → cuotas exactas; test unitario exhaustivo de redondeo (residuos, N=2, importes indivisibles).
3. `expense-service.createExpense` dentro de TX: expense + debts + audit_log.
4. Recibo bancario: variante que crea deudas ya `liquidado en origen`.
5. `markPaid`: exige comprobante — comprimir imagen en cliente antes de subir (browser-image-compression o similar), validar tipo/tamaño tras compresión (10MB, JPEG/PNG/PDF), subir a MinIO vía `storage.ts` (Fase 1) → estado `pendiente_confirmacion`.
6. `confirmReceipt`: TX con `FOR UPDATE`, idempotente, autoriza solo Admin o acreedor original; recalcula estado agregado del gasto.
7. Vistas: libro contable (todos), "mi estado de cuenta" (Propietario, con desglose), vista agregada (Invitado, sin desglose individual).
8. Auditar cada movimiento.

## Todo list
- [ ] Schema expenses/debts/payment_proofs con importes en céntimos
- [ ] `debt-splitter` puro con redondeo determinista + tests unitarios
- [ ] createExpense en transacción (expense+debts+audit)
- [ ] Recibo bancario "liquidado en origen"
- [ ] markPaid con comprobante obligatorio → pendiente_confirmacion
- [ ] confirmReceipt idempotente con FOR UPDATE + autorización dual
- [ ] Vistas ledger: individual (owner) vs agregada (guest)
- [ ] Retry en serialization_failure

## Success Criteria
- [ ] Para cualquier importe y N, Σ cuotas == importe exacto (test property-based).
- [ ] Dos confirmaciones concurrentes (Admin + acreedor) dejan la cuota `Confirmado` una sola vez, sin doble acreditación (test de concurrencia).
- [ ] Marcar pagado sin comprobante es rechazado.
- [ ] Invitado nunca ve desglose individual en las vistas de ledger.
- [ ] Caída simulada a mitad de createExpense no deja deudas huérfanas (rollback completo).

## Risk Assessment
| Riesgo | Prob×Impacto | Mitigación |
|--------|--------------|------------|
| **Saldos inconsistentes por fallo/parcialidad** | Media×**Crítico** | Todas las mutaciones de deuda en TX explícita; rollback atómico; tests de fallo a mitad |
| **Doble confirmación (carrera Admin/acreedor)** | Media×**Alto** | `SELECT FOR UPDATE` + idempotencia + aislamiento SERIALIZABLE con retry |
| Errores de redondeo (float/céntimos) | Alta×Alto | Enteros de céntimos; residuo determinista al último deudor; test property-based |
| Recalcular deudas al cambiar N (altas/bajas) | Media×Alto | Snapshot de participantes por gasto; nunca recálculo retroactivo |
| Comprobante con archivo malicioso | Media×Medio | Validar MIME/tamaño real (10MB tras compresión, JPEG/PNG/PDF); subida a bucket MinIO privado (Fase 1), nunca al filesystem de la app |

## Security Considerations
- Autorización estricta: solo el deudor marca su cuota; solo Admin/acreedor confirman.
- Guest jamás accede a `debts` individuales (filtrar en servicio, no en UI).
- Comprobantes: comprimir en cliente, validar tipo/tamaño real en servidor, nombres saneados, subir a MinIO (bucket privado) y servir vía URL firmada temporal.
- Auditoría inmutable de cada cambio de estado (actor+timestamp, PRD §5).

## Next steps
Cierra el MVP financiero (Roadmap F1). Fase 4: automatizar la entrada de gastos con OCR web.
