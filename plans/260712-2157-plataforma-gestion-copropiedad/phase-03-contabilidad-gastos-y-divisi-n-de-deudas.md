---
phase: 3
title: "Contabilidad, gastos y división de deudas"
status: implemented
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
- **Estado de implementación:** Implementado (rama `feat/0.3.0-contabilidad-gastos`, mergeado a `develop`)
- **Estado de revisión:** Revisado por `code-reviewer` (1 alto + 3 medios + 2 bajos, todos corregidos salvo el bajo #7 documentado abajo). Verificado manualmente end-to-end vía curl, incluyendo dos escenarios reales de concurrencia contra Postgres (confirmación dual de una misma cuota, y confirmación simultánea de dos cuotas hermanas del mismo gasto).

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
- [x] Schema expenses/debts/payment_proofs con importes en céntimos
- [x] `debt-splitter` puro con redondeo determinista + tests unitarios (incluye barrido property-based)
- [x] createExpense en transacción (expense+debts+audit)
- [x] Recibo bancario "liquidado en origen"
- [x] markPaid con comprobante obligatorio → pendiente_confirmacion (+ FOR UPDATE y guard de estado en el UPDATE, hallazgo de code review)
- [x] confirmReceipt idempotente con FOR UPDATE + autorización dual (+ FOR UPDATE también sobre `expenses` al recalcular el agregado, hallazgo de code review — ver nota abajo)
- [x] Vistas ledger: individual (owner) vs agregada (guest)
- [x] Retry en serialization_failure — no aplica: se optó por la alternativa que el propio plan permite ("SERIALIZABLE o REPEATABLE READ + FOR UPDATE"), usando locks `FOR UPDATE` explícitos en vez de aislamiento SERIALIZABLE, así que no hay `serialization_failure` que reintentar.

## Success Criteria
- [x] Para cualquier importe y N, Σ cuotas == importe exacto (test property-based, `debt-splitter.test.ts`, barrido de importes 0-5000 céntimos × N=1-11).
- [x] Dos confirmaciones concurrentes (Admin + acreedor) dejan la cuota `Confirmado` una sola vez, sin doble acreditación (verificado con curl real en paralelo contra Postgres, misma `confirmed_at`/`confirmed_by` en ambas respuestas).
- [x] Marcar pagado sin comprobante es rechazado (400) — además, comprobante con Content-Type declarado falso también se rechaza (verificación de magic bytes, hallazgo de code review).
- [x] Invitado nunca ve desglose individual en las vistas de ledger (`participantSnapshot`/`debts` se omiten server-side, no solo en la UI — verificado con curl).
- [x] Caída simulada a mitad de createExpense no deja deudas huérfanas (rollback completo) — verificado por inspección de código (expense+debts+audit_log en la misma `db.transaction`), no se forzó un fallo real a mitad de transacción (no hay forma barata de simularlo con curl).

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

## Nota de implementación (post-hoc)

- **Bug crítico pre-existente descubierto y corregido (afectaba también a la Fase 2 ya mergeada):** al final de la Fase 2 se añadió `h3` como devDependency explícita solo para que `vitest` pudiera resolver `import type { H3Event } from 'h3'`. Eso introdujo una segunda versión de `h3` (2.0.1-rc.x) compitiendo con la que usa Nitro internamente (`h3@1.15.11`, viene de `nuxt@4.4.8`). El auto-import de Nitro para `readBody` empezó a resolver contra la versión equivocada, rompiendo **todos** los endpoints POST con body JSON de toda la app (`event.req.headers.get is not a function`). Un proceso `nuxt dev` que llevaba corriendo desde antes de ese cambio ocultó el problema durante toda la verificación de la Fase 2 y buena parte de la Fase 3 (usaba una resolución de módulos ya fijada antes de instalar la nueva dependencia); solo se manifestó al reiniciar el servidor dev. Corrección: `h3` fijado a la versión exacta que usa Nitro (`1.15.11`, confirmado con `pnpm why h3`); se quitaron los imports explícitos de valores de `h3` (`createError`) en `server/utils/rbac.ts` y `server/services/expense-service.ts`, volviendo al auto-import global de Nitro (patrón ya usado en el resto del código server); `vitest.setup.ts` nuevo hace polyfill de `globalThis.createError` solo para el proceso de vitest (nunca toca el bundle de Nitro). Se re-verificó todo el flujo de la Fase 2 (bootstrap-admin, invitaciones, RBAC, bloqueo de rutas admin nativas) contra un servidor reiniciado desde cero — sigue funcionando correctamente.
- **Reparto configurable por porcentaje (PRD §3.1, "Admin configura porcentajes de participación"):** no implementado en esta fase. `debt-splitter.ts` solo hace división equitativa entre N participantes (con redondeo determinista), que es lo que describe literalmente la Architecture de este plan. El array `participantSnapshot` ya deja la puerta abierta a pesos por participante si se necesita más adelante, pero añadir una UI de configuración de porcentajes queda fuera de alcance aquí (YAGNI).
- **Usuario de sistema "Fondo Común"** (`server/db/seed/fondo-comun.ts`, id fijo `system-fondo-comun`, `banned=true`, sin fila en `accounts`): sembrado vía plugin Nitro en el arranque, para que la Fase 7 (derramas) tenga un acreedor cuando nadie ha adelantado el dinero. Excluido explícitamente de `GET /api/members` y con guardas dedicadas en `role.patch.ts`/`deactivate.post.ts` (hallazgo de code review — inicialmente aparecía como un miembro más, gestionable por error).
- **Confirmación dual concurrente:** se optó por `SELECT ... FOR UPDATE` en vez de aislamiento `SERIALIZABLE` (alternativa que el propio plan permite explícitamente). Esto cubre dos escenarios de carrera reales, verificados con curl en paralelo contra Postgres: (1) dos actores confirmando la MISMA cuota a la vez, y (2) dos cuotas HERMANAS del mismo gasto confirmadas casi a la vez por actores distintos — este segundo caso lo encontró el code review (el recálculo del `expenses.status` agregado no heredaba el lock de la cuota individual y podía quedar fijado en `partial` de forma permanente); se añadió un `FOR UPDATE` adicional sobre la fila de `expenses` antes de leer las debts hermanas.
- **Validación de comprobantes:** además del filtro por `Content-Type` declarado y límite de 10MB, se añadió verificación de magic bytes (`server/utils/file-signature.ts`) para que un archivo no pueda mentir sobre su tipo real (hallazgo de code review).
- **Sin test HTTP de integración automatizado para expense-service:** hay test unitario puro del splitter (incluye barrido property-based) más verificación manual exhaustiva con curl (incluyendo los dos escenarios de concurrencia reales contra Postgres), pero no quedó como test repetible en el repo. Igual que en la Fase 2, se documenta como gap conocido en vez de ocultarlo.
