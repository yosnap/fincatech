---
phase: 1
title: "Phase 1: Diagnóstico y detector de duplicados"
status: in-progress
priority: P1
effort: 5h
dependencies: []
---

# Phase 1: Diagnóstico y detector de duplicados

## Goal
Probar por qué aparecen aportes duplicados y evitar que vuelva a pasar, avisando de los posibles duplicados ya existentes.

## Files to Create / Modify
- Modify: `server/services/contribution-service.ts` (función `findPossibleDuplicates`)
- Create: `server/api/bank/contributions/duplicates.get.ts`
- Modify: `server/api/bank/contributions/index.post.ts` (flag `force` para registrar pese al aviso)
- Modify: `app/components/bank/ContributionForm.vue` (aviso con «Registrar igualmente»)
- Modify: `app/pages/banco/contribuciones.vue` (bloque «Posibles duplicados», solo admin)
- Test: `server/services/bank-core.test.ts` (criterio de duplicado puro)

## Tasks & Steps
1. **Diagnóstico (solo lectura, producción):** consultar los pares de aportes con mismo `member_id`, `amount_cents`, `type`, `date` y comparar `created_at`, `registered_by` y entradas `contribution_created` en `audit_log`. Separación de segundos → doble envío/reintento; separación grande o distinto `registered_by` → doble registro humano (miembro + admin). Guardar conclusión en `plans/reports/`.
2. Criterio de duplicado (función pura en `bank-core.ts`): mismo miembro, importe, tipo y fecha (y período si es cuota). Tests.
3. `POST /api/bank/contributions`: si existe un posible duplicado y `force` no viene a `true`, responder 409 con `code: 'possible_duplicate'` y el aporte existente.
4. Formulario: ante ese 409, mostrar el aviso con los datos del aporte existente y botones «Cancelar» / «Registrar igualmente». El botón de envío queda deshabilitado mientras `submitting` (verificar que `:loading` de Nuxt UI lo bloquea; si no, añadir guard explícito).
5. `GET /api/bank/contributions/duplicates` (admin): grupos de posibles duplicados; en la página, bloque informativo con enlace para eliminar el sobrante (reutiliza el borrado existente).

## Verification
- `pnpm test` (criterio de duplicado).
- Manual: registrar dos veces el mismo extraordinario → aparece el aviso; con «Registrar igualmente» se crea.
- El listado de duplicados muestra los casos reales encontrados en el diagnóstico.

## Red Team (2026-11-08) — corrección pendiente
- [ ] **[RT-6]** La comprobación de duplicado está fuera de la transacción: dos envíos casi simultáneos pasan ambos. Moverla dentro de `db.transaction` con `pg_advisory_xact_lock(hashtext(memberId|type|date|amountCents))` antes del `select`. Test de concurrencia (dos `createContribution` en paralelo → uno 409).
