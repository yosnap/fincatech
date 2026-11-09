---
phase: 7
title: "Phase 7: Cargo automático de la hipoteca"
status: completed
priority: P1
effort: 7h
dependencies: [2]
---

# Phase 7: Cargo automático de la hipoteca

> Se ejecuta **antes de la fase 3** (decisión del usuario 2026-11-08), para que el MCP y el bot la expongan también. El número de fase solo indica el orden de alta en el plan.

## Goal
El admin configura en el banco el importe y el día de cargo de la hipoteca; cada mes se crea sola la salida bancaria, se rellenan de golpe los meses desde septiembre de 2026 y el admin elige qué pagos manuales antiguos borrar.

## Decisiones (usuario, 2026-11-08)

| Decisión | Valor |
|---|---|
| Importe | Histórico por tramos: cada entrada «importe desde el mes X». Cambiar el importe no altera los meses anteriores |
| Día de cargo | Configurable (1-31); si el mes es más corto, último día del mes |
| Retroactivo | Desde el mes que indique el admin (septiembre de 2026 basta; agosto fue distinto) |
| Pagos manuales previos | **Adoptar** (decisión del usuario tras el red-team): se muestran los candidatos y los que el admin elija pasan a ser el cargo automático de su mes (se les asigna `mortgage_period`), conservando su justificante. Los meses sin pago adoptado se crean nuevos. Nada se borra |

## Diseño

1. **Tabla `mortgage_schedule`**: `id`, `amount_cents`, `charge_day` (1-31), `effective_from` ('YYYY-MM', único), `created_by` (FK users), `created_at`. El importe de un mes es el de la entrada con mayor `effective_from <= mes`.
2. **`bank_transactions.mortgage_period`** ('YYYY-MM', nullable) con índice único parcial `where mortgage_period is not null and deleted_at is null` (**[RT8-10]**, la columna `deleted_at` llega en la fase 8, que se ejecuta antes): un único cargo automático por mes, generación idempotente (`onConflictDoNothing`). Descripción `Hipoteca YYYY-MM`, `direction = 'withdrawal'`, sin categoría, `registered_by = created_by` de la entrada vigente.
3. **Marca de agua `finance_settings.mortgage_generated_through`** ('YYYY-MM'): el cron solo crea meses posteriores a la marca. Así, si el admin borra a mano un cargo automático (p. ej. un mes que no se cobró), no reaparece al día siguiente.
4. **Guardar configuración = rellenar.** Al añadir o editar una entrada, se generan los meses vencidos que falten desde su `effective_from` hasta hoy, y los cargos automáticos ya existentes de esos meses con otro importe o día se corrigen (solo los automáticos, nunca los manuales). Es una acción explícita del admin, así que puede recrear un mes que se había borrado; se avisa en la respuesta.
5. **Cron diario** (06:00 Europe/Madrid, `noOverlap`) en `server/plugins/mortgage-scheduler.ts`: crea el cargo del mes cuando llega su día de cargo y avanza la marca.
6. **Candidatos manuales**: salidas con `mortgage_period is null` en los meses cubiertos cuyo importe coincide con el del tramo, o cuya descripción contiene «hipoteca» (sin distinguir mayúsculas). Se borran con el `deleteTransaction` existente (desvincula y limpia justificantes) en un endpoint de borrado múltiple con confirmación.
7. **Edición y borrado** de un cargo automático: con la edición de movimientos que ya existe; se muestra con la etiqueta «Automático».

## Files to Create / Modify
- Create: `server/db/schema/mortgage.ts` (`mortgageSchedule`); Modify: `server/db/schema/bank.ts` (`mortgagePeriod` + índice, `mortgageGeneratedThrough`), `server/db/schema/index.ts`
- Create: migración vía `pnpm db:generate`
- Create: `server/services/mortgage-core.ts` + `mortgage-core.test.ts` (importe por mes, fecha de cargo con recorte a fin de mes, meses pendientes, detección de candidatos)
- Create: `server/services/mortgage-service.ts` (listar/añadir/editar/borrar tramos, `previewBackfill`, `confirmBackfill` (adopta + crea en una tx), `generateDueCharges`)
- Create: `server/api/bank/mortgage/index.get.ts`, `index.post.ts`, `[id].patch.ts`, `[id].delete.ts`, `backfill/preview.get.ts`, `backfill/confirm.post.ts` (todo solo admin)
- Create: `server/plugins/mortgage-scheduler.ts`
- Create: `app/components/bank/MortgageSettings.vue` (tramos + alta/edición) y `app/components/bank/MortgageCandidatesDialog.vue` (vista previa: meses a crear y pagos manuales con casillas «Adoptar como cargo de hipoteca»)
- Modify: `app/pages/banco/index.vue` (acceso desde configuración), `app/components/bank/TransactionList.vue` (etiqueta «Automático»)
- Modify (fase 4): herramientas `ver_hipoteca`, `configurar_hipoteca`, `listar_pagos_hipoteca_manuales`

## Tasks & Steps
1. **Backup de la BD** antes de migrar (local y producción).
2. Esquema + migración (columnas nuevas nullable; sin backfill de datos).
3. `mortgage-core.ts` con tests: tramo vigente por mes, día 31 en febrero → 28/29, meses pendientes respetando la marca, sin meses futuros.
4. Servicio con transacciones y `writeAuditLog` (`mortgage_schedule_*`, `mortgage_charge_generated`, `mortgage_manual_deleted`).
5. Endpoints con zod; borrado múltiple acepta solo ids que sigan siendo candidatos (evita borrar algo que no lo es).
6. Cron diario + ejecución también al arrancar el servidor (recupera días en que estuvo caído).
7. UI: sección «Hipoteca» en la configuración del banco; tras guardar, si hay candidatos manuales, se abre el diálogo para elegir cuáles borrar. Sin `border-l-*`.

## Verification
- `pnpm test` (mortgage-core), `pnpm lint`, `pnpm typecheck`.
- Local: tramo de septiembre de 2026 → se crean septiembre, octubre y noviembre (si su día ya pasó); salen como candidatos los pagos manuales equivalentes; al adoptarlos el saldo queda exactamente igual que antes y los justificantes se conservan.
- Reiniciar el servidor no duplica cargos; borrar el cargo de un mes no lo recrea el cron.
- Cambiar el importe desde diciembre no modifica septiembre a noviembre.

## Red Team (2026-11-08) — sustituye a los puntos 4, 6 y 7 del diseño donde contradigan
- **[RT-9] Flujo único previsualizar → confirmar, en una sola transacción:** la vista previa lista meses a crear y candidatos manuales (con indicador de justificante); al confirmar, los candidatos elegidos se **adoptan** (`mortgage_period = mes`) y se crean solo los meses restantes. No se usa `deleteTransaction`; nunca se borran justificantes.
- **[RT-10]** El relleno **solo crea meses que faltan; nunca modifica cargos existentes**. Editar un cargo automático con el editor de movimientos lo convierte en manual (`mortgage_period = null`, con aviso en la UI) para que nada lo vuelva a tocar. Borrar o mover un tramo no altera cargos ya creados.
- **[RT-10]** Marca de agua guardada con upsert de la fila `global` (o tabla propia); avanza al confirmar el relleno y en cada ejecución del cron.
- **[RT-10]** Validación `effective_from >= '2026-09'`. Las herramientas `configurar_hipoteca` y de adopción son `destructive`; la confirmación indica «Se crearán N cargos (meses…) y se adoptarán M pagos».
- Fechas con la utilidad Madrid compartida y `today` inyectable; auditoría del cron con canal `system`.

## Interacción con la papelera (red-team fase 8, 2026-11-08)
- Un mes cuyo cargo automático está en la papelera cuenta como **ocupado**: el relleno no lo recrea; la vista previa lo muestra como «en la papelera — restaurar» en lugar de crear uno nuevo.
- Restaurar un cargo cuyo mes ya tiene otro cargo vivo → 409 legible.
- Purgar un cargo automático avisa en la confirmación de que ese mes no se regenerará.
- Los candidatos para adoptar excluyen filas en la papelera.


## Estado de la implementación (2026-11-08)

Implementado con el flujo del red-team (RT-9/RT-10) y la interacción con la papelera:

- **Migración `0017_melodic_star_brand.sql`:** `mortgage_schedule` (tramos con `effective_from` único), `bank_transactions.mortgage_period` con índice único parcial `where mortgage_period is not null and deleted_at is null`, `finance_settings.mortgage_generated_through`.
- **`mortgage-core.ts`** (puro, 8 tests): importe por tramo vigente, `chargeDateFor` con recorte a fin de mes, rango sin meses futuros, `planMortgageCharges` (relleno y cron comparten planificador), `findManualCandidates`, `todayInMadrid` con `now` inyectable.
- **`mortgage-service.ts`:** CRUD de tramos auditado (`mortgage_schedule_*`), `previewBackfill`, `confirmBackfill` (adopción + creación en una sola transacción con advisory lock, rechazo en bloque de ids no candidatos, avance de la marca de agua), `generateDueCharges` para el cron (audit `channel: system`), `assertNoOtherChargeForMonth` para el 409 al restaurar.
- **Endpoints** (solo admin): `GET/POST /api/bank/mortgage`, `PATCH/DELETE /api/bank/mortgage/[id]`, `GET /api/bank/mortgage/backfill/preview`, `POST /api/bank/mortgage/backfill/confirm`.
- **Cron:** `server/plugins/mortgage-scheduler.ts` (06:00 Europe/Madrid + una pasada a los 30s del arranque).
- **UI:** `app/components/bank/MortgageSettings.vue` (tramos + acceso al relleno desde el botón «Hipoteca» de `/banco`), `MortgageBackfillDialog.vue` (meses a crear, candidatos con casillas para adoptar, meses en la papelera), badge «Automático» en `TransactionList.vue`, aviso al editar un cargo automático y nota al purgarlo desde `/admin/trash`.
- **Tests:** `mortgage-core.test.ts` (unitarios) y `mortgage-service.integration.test.ts` (Postgres real): relleno idempotente, adopción sin duplicar importe, rechazo de ids no candidatos, mes en la papelera no recreado y cron respetando día de cargo y marca de agua.
- **Pendiente manual:** copia de seguridad de la BD de producción antes de desplegar y revisar la vista previa del relleno en real antes de confirmar (los candidatos manuales dependen de los importes/descripciones existentes).
