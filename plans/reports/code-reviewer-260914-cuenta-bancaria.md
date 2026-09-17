# Code Review — Cuenta bancaria (feat/v0.16.0, sin commitear)

- **Fecha:** 2026-09-14
- **Revisor:** code-reviewer
- **Alcance:** server/db/schema/bank.ts, drizzle/migrations/0015_fine_iron_fist.sql, server/services/{bank-core,bank-service,contribution-service}.ts (+test), server/api/bank/** (14 endpoints), app/pages/banco/**, app/components/bank/** (11), y toques en settlement-service.ts, liquidacion.vue, default.vue, schema/index.ts. ~2.400 LOC nuevos + 60 modificadas.
- **Verificación ejecutada:** `nuxt typecheck` exit 0 · `eslint` 0 incidencias en los ficheros nuevos/modificados · `vitest run` 55/55 (25 nuevos de bank-core) · migración 0015 registrada en `_journal.json`.

## Overall Assessment

Implementación sólida y fiel al plan. El núcleo puro (bank-core) está bien testeado, la separación core/wrapper respeta el patrón del repo, las transacciones multi-mes y auto-ingreso son atómicas con audit dentro de la tx, el upload a MinIO va antes de DB con cleanup en catch, y los RBAC por endpoint están correctos (borrado de movimientos/settings solo admin; aportes autor-o-admin). El settlement pairwise queda intacto (fondoComun additive). No hay N+1 (bulk fetch con `inArray` en listings). Sin regresiones detectadas en los touchpoints.

Se hallan **1 hallazgo Alto** (fuga de desglose individual al Invitado) y **4 Medios**, ninguno bloqueante de merge pero los dos primeros deberían arreglarse antes de considerar la sección cerrada.

## Crítico

Ninguno.

## Alto

### A1. El Invitado ve el desglose individual de efectivo pendiente de otros miembros
- **Archivo:** `server/api/bank/summary.get.ts:41-48` (y tarjeta en `app/components/bank/ReconciliationSummary.vue:88-98`)
- **Escenario de fallo:** `canSeeIndividualDebt(actor)` solo gatea `fondoComun`. `cashPending` se calcula sobre TODAS las contribuciones y se devuelve con `memberId`, `memberName`, `amountCents` y `date` a cualquier rol autenticado, incluido `guest`. Un Invitado que abra /banco ve "Efectivo sin depositar: Ana · 250 € · 12/08…", es decir, desglose económico individual de terceros, exactamente lo que el PRD §3 oculta (`canSeeIndividualDebt`) y lo que el criterio de aceptación (e) exige ("contribuciones ajenas invisibles"). El endpoint `contributions/index.get.ts` sí filtra por miembro para guest — inconsistencia interna.
- **Fix sugerido:** en `summary.get.ts`, gatear el listado: `cashPending: canSeeIndividualDebt(actor) ? reconciliation.cashPending.map(...) : []`, conservando el agregado `cashPendingCents` (información comunal de tesorería) si así se decide; la consulta de nombres (`users`) puede quedar dentro del condicional y ahorrar la query para guests.

## Medio

### M1. Flujo de registro de aportes roto para Invitado: UI lo ofrece, el servicio lo rechaza siempre
- **Archivos:** `server/services/contribution-service.ts:66`, `server/api/bank/contributions/index.post.ts:35`, `server/api/bank/contributions/grid.get.ts:6`, `app/pages/banco/contribuciones.vue:158-163,218-228`
- **Escenario de fallo:** `index.post` acepta rol `guest` y el comentario de `grid.get.ts` promete "el Invitado solo ve y registra sus propias contribuciones"; la página muestra a los Invitados el botón "Registrar aporte" y el formulario. Pero la validación de miembro exige `member.role === 'admin' || 'owner'`, así que un guest registrándose a sí mismo recibe siempre `400 "Miembro inválido: debe ser un miembro activo"`. Flujo muerto con mensaje confuso.
- **Fix sugerido (decisión de producto, elegir una):**
  1. Cerrar el flujo: quitar `guest` del `requireRole` de `index.post` (403), ocultar el botón/formulario para `isGuest` y corregir el comentario de `grid.get.ts`. Coherente con `computeFondoComun`, cuyo N solo cuenta admin/owner (un aporte de guest hoy desaparecería del desglose).
  2. O permitirlo: relajar la validación de miembro a "existe y no baneado" y aceptar las consecuencias contables (los aportes de guest no entrarían al reparto de salidas).
  La opción 1 es la mínima y coherente con el dominio.

### M2. Carrera en adjuntar justificante: el 409 se puede burlar y duplicar filas en payment_proofs
- **Archivos:** `server/api/bank/transactions/[id]/proof.post.ts:22-29` + `server/services/bank-service.ts:84-106`
- **Escenario de fallo:** el check `existing.hasProof` ocurre FUERA de la tx, y `attachTransactionProof` —pese a hacer `SELECT … FOR UPDATE`— no re-comprueba `hasProof` dentro. Dos `POST …/proof` concurrentes pasan ambos el check externo, suben dos objetos a MinIO e insertan dos filas en `payment_proofs` para el mismo `entityId`. `hasProof` queda `true` (no corrupto) y `proof.get` devuelve el último por `createdAt`, pero el contrato "un justificante, 409 si ya existe" se rompe y queda un objeto/registro redundante.
- **Fix sugerido:** dentro de `attachTransactionProof`, tras el `FOR UPDATE`: `if (transaction.hasProof) throw createError({ statusCode: 409, … })`. El perdedor de la carrera recibirá 409 y su catch en el endpoint limpiará su objeto de MinIO (ya existe ese cleanup).

### M3. PATCH de aporte puede romper el invariante fecha depósito ≥ fecha aporte
- **Archivos:** `server/services/contribution-service.ts:243-270`, `server/api/bank/contributions/[id].patch.ts:9-14`
- **Escenario de fallo:** `linkContribution` valida `transaction.date >= contribution.date` al vincular, pero `updateContribution` (admin) permite mover `date` hacia el futuro sin re-validar contra el movimiento vinculado. Resultado: aporte "depositado" cuya fecha posterior hace la relación imposible (y un día el admin desvincula/vincula y se lleva un 400 incomprensible). Mismo efecto si `linkContribution` y `updateContribution` corren concurrentes (el link lee el transaction sin lock y la fecha del aporte cambia a la vez), aunque el window es mínimo.
- **Fix sugerido:** en `updateContribution`, si `input.date` cambia y `contribution.bankTransactionId` no es null, validar contra la fecha del movimiento vinculado (segunda consulta dentro de la misma tx) y 400 si la viola.

### M4. Fechas calendar-invalidas pasan el regex y acaban en 500
- **Archivos:** `server/api/bank/transactions/index.post.ts:11`, `server/api/bank/contributions/index.post.ts:11`, `server/api/bank/contributions/[id].patch.ts:9`, `server/api/bank/settings.put.ts:5`
- **Escenario de fallo:** `/^\d{4}-\d{2}-\d{2}$/` acepta `2026-02-31`. Drizzle lo pasa al driver y Postgres rechaza la fecha (`date/time field value out of range`) → 500 sin mensaje útil, con rollback (sin daño de datos).
- **Fix sugerido:** `z.string().refine(v => !Number.isNaN(Date.parse(v)))` o comparación contra un `Date` construido por partes; alternativamente capturar el código 22008 y degradarlo a 400.

## Bajo

1. **Comentario contradictorio en `server/api/bank/contributions/[id].delete.ts:5-6`:** dice "Si el aporte por transferencia era el último referente de su ingreso auto-creado, el movimiento se borra también dentro de la misma transacción", pero `deleteContribution` (contribution-service.ts:278-283) dice y hace lo contrario (el movimiento nunca se borra; queda como ingreso sin origen). Comentario engañoso para mantenimiento futuro: corregir al texto del servicio.
2. **Parámetros de ruta sin validar como UUID:** `[id].get`, `[id].delete`, `proof.get/post`, `[id].patch/delete` mandan el string crudo a un `eq(uuid)` → `invalid input syntax for type uuid` → 500 en vez de 404/400. Es el patrón preexistente del repo (p. ej. `server/api/expenses/[id].get.ts`), así que no es regresión; si se arregla, arreglarlo global, no solo en bank.
3. **`updateSettings` (bank-service.ts:194-227):** upsert + audit log fuera de tx (el repo usa audit dentro de la tx en las mutaciones). Impacto mínimo (settings es idempotente); unificar si se toca de nuevo.
4. **`app/pages/banco/contribuciones.vue:68-70`:** `refreshAll` refresca contribuciones y grid pero no `txData`, así que el desplegable de `LinkDepositDialog` puede quedar con candidatos obsoletos en sesiones largas (p. ej. tras crear un ingreso en otra pestaña). Cosmético.
5. **Auditoría multi-mes:** `contribution_created` registra solo el `entityId` de la primera fila (metadata sí incluye `months`). Trazabilidad aceptable; anotado por completitud.
6. **Sin cota superior en `amountCents`:** `int().positive()` sin máximo; un valor ≥ 2^31 (o el total × meses de una transferencia) desborda `int4` → 500. Solo afecta a endpoints admin; añadir `.max()` si se quiere robustez.
7. **`computeFondoComun` y miembros dados de baja:** las contribuciones de un miembro posteriormente desactivado/baneado salen del desglose (no está en `activeMembers`) y Σ saldos_i deja de cuadrar con fondo − externos. Está documentado como decisión de producto ("sin histórico de altas/bajas"); dejarlo anotado como skew contable conocido para la Fase 7 (derramas).

## Verificación de criterios de aceptación

| Criterio | Estado | Notas |
|---|---|---|
| (a) CRUD movimientos + justificante diferido + saldo calculado + pre-compra estricto `<` | OK | `hasProof` false→true vía proof.post; `computeBalances` usa `<` estricto (testeado); saldo nunca persistido |
| (b) Tipos de aporte, opción B, 403 no-admin, adelanto multi-mes atómico, 409 amigable (23505) | PARCIAL | Todo correcto salvo M1 (guest) — el resto verificado: tx única, índice único parcial en migración, `getPgErrorCode` con causa |
| (c) Transfer auto-crea ingreso vinculado, proof al MOVIMIENTO, cash sin file | OK | `buildTransferDescription` testeado; file+cash → 400; proof con `entityType 'bank_transaction'` |
| (d) Conciliación: cash sin vínculo = pendiente; link con validaciones (deposit, sin categoría, fecha ≥); borrado desvincula; externos no unmatched | OK | Testeado en bank-core; validaciones en `linkContribution`; desvinculación en `deleteTransaction` antes del delete |
| (e) Fondo común: fórmula, resto alfabético determinista, externos no acreditados, guest null/403/invisible | PARCIAL | Núcleo testeado y correcto; 'fondo' excluido por rol (no hace falta banned); PERO A1 (cashPending filtrado al guest) |
| (f) Borrado duro admin (movimientos/settings) y autor-o-admin (aportes) | OK | Revisado endpoint a endpoint |
| (g) Sin regresiones: settlement pairwise intacto, expenses/debts no tocados | OK | diff de settlement-service estrictamente additive; liquidacion.vue solo añade sección gated por `data.fondoComun` (protegida por `v-if="data"` externo) |
| (h) MinIO cleanup, sin N+1, <1000 líneas | OK | cleanup en catch de los 3 puntos de upload y en delete; bulk fetch en listings; fichero mayor 278 líneas |

## Positive Observations (calibración de riesgo)

- `bank-core.test.ts` cubre los invariantes que importan: resto determinista con Σ partes = Σ salidas, estricto `<` en pre-compra, estabilidad del orden del saldo, y el caso "un depósito ampara varios aportes".
- El manejo de `getPgErrorCode` (DrizzleQueryError → `.cause.code`) está verificado empíricamente y documentado en el propio util.
- La decisión de NO borrar el ingreso auto-creado al borrar el aporte está bien razonada en el comentario del servicio (no se puede distinguir fiablemente auto-creado de manual re-vinculado).

## Recommended Actions

1. **Antes de cerrar la fase:** A1 (gatear `cashPending` por `canSeeIndividualDebt` en summary.get.ts) y M1 (decidir y coherenciar el flujo guest).
2. **Recomendado en la misma rama:** M2 (re-check `hasProof` dentro de la tx) y M3 (validar fecha al editar aporte vinculado).
3. **Opcional/backlog:** M4, y los Bajos 1-7.

## Metrics

- Typecheck: OK (exit 0)
- Lint: 0 incidencias en ficheros del cambio
- Tests: 55/55 (25 nuevos en bank-core.test.ts)
- Hallazgos: 0 Crítico · 1 Alto · 4 Medio · 7 Bajo

## Unresolved Questions

1. ¿Puede un Invitado registrar sus propios aportes (M1)? Hoy: UI sí, servicio no. Requiere decisión de producto (y, si se permiten, cómo contabilizan en el fondo común).
2. ¿El agregado `cashPendingCents` debe seguir visible al Invitado una vez oculto el desglose (A1)? Asumo que sí (información comunal de tesorería) — confirmar.
