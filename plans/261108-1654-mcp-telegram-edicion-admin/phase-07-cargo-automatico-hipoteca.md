---
phase: 7
title: "Phase 7: Cargo automático de la hipoteca"
status: todo
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
| Pagos manuales previos | Se muestran los candidatos (salidas de esos meses con el mismo importe o con «hipoteca» en la descripción) y el admin marca cuáles borrar. Nada se borra solo |

## Diseño

1. **Tabla `mortgage_schedule`**: `id`, `amount_cents`, `charge_day` (1-31), `effective_from` ('YYYY-MM', único), `created_by` (FK users), `created_at`. El importe de un mes es el de la entrada con mayor `effective_from <= mes`.
2. **`bank_transactions.mortgage_period`** ('YYYY-MM', nullable) con índice único parcial `where mortgage_period is not null`: un único cargo automático por mes, generación idempotente (`onConflictDoNothing`). Descripción `Hipoteca YYYY-MM`, `direction = 'withdrawal'`, sin categoría, `registered_by = created_by` de la entrada vigente.
3. **Marca de agua `finance_settings.mortgage_generated_through`** ('YYYY-MM'): el cron solo crea meses posteriores a la marca. Así, si el admin borra a mano un cargo automático (p. ej. un mes que no se cobró), no reaparece al día siguiente.
4. **Guardar configuración = rellenar.** Al añadir o editar una entrada, se generan los meses vencidos que falten desde su `effective_from` hasta hoy, y los cargos automáticos ya existentes de esos meses con otro importe o día se corrigen (solo los automáticos, nunca los manuales). Es una acción explícita del admin, así que puede recrear un mes que se había borrado; se avisa en la respuesta.
5. **Cron diario** (06:00 Europe/Madrid, `noOverlap`) en `server/plugins/mortgage-scheduler.ts`: crea el cargo del mes cuando llega su día de cargo y avanza la marca.
6. **Candidatos manuales**: salidas con `mortgage_period is null` en los meses cubiertos cuyo importe coincide con el del tramo, o cuya descripción contiene «hipoteca» (sin distinguir mayúsculas). Se borran con el `deleteTransaction` existente (desvincula y limpia justificantes) en un endpoint de borrado múltiple con confirmación.
7. **Edición y borrado** de un cargo automático: con la edición de movimientos que ya existe; se muestra con la etiqueta «Automático».

## Files to Create / Modify
- Create: `server/db/schema/mortgage.ts` (`mortgageSchedule`); Modify: `server/db/schema/bank.ts` (`mortgagePeriod` + índice, `mortgageGeneratedThrough`), `server/db/schema/index.ts`
- Create: migración vía `pnpm db:generate`
- Create: `server/services/mortgage-core.ts` + `mortgage-core.test.ts` (importe por mes, fecha de cargo con recorte a fin de mes, meses pendientes, detección de candidatos)
- Create: `server/services/mortgage-service.ts` (listar/añadir/editar/borrar tramos, `generateDueCharges`, `listManualCandidates`, `deleteManualCandidates`)
- Create: `server/api/bank/mortgage/index.get.ts`, `index.post.ts`, `[id].patch.ts`, `[id].delete.ts`, `candidates.get.ts`, `candidates/delete.post.ts` (todo solo admin)
- Create: `server/plugins/mortgage-scheduler.ts`
- Create: `app/components/bank/MortgageSettings.vue` (tramos + alta/edición) y `app/components/bank/MortgageCandidatesDialog.vue` (lista con casillas y «Borrar seleccionados»)
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
- Local: tramo de septiembre de 2026 → se crean septiembre, octubre y noviembre (si su día ya pasó); salen como candidatos los pagos manuales equivalentes; al borrarlos el saldo queda igual que antes.
- Reiniciar el servidor no duplica cargos; borrar el cargo de un mes no lo recrea el cron.
- Cambiar el importe desde diciembre no modifica septiembre a noviembre.
