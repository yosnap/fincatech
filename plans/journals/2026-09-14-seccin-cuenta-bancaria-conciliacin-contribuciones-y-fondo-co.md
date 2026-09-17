---
title: "Sección Cuenta bancaria: conciliación, contribuciones y fondo común"
date: 2026-09-14
summary: "Implementación completa del plan 260914-0222 en feat/v0.16.0: 3 tablas nuevas (migración 0015), bank-core puro con 25 tests, 14 endpoints /api/bank, UI /banco + fondo común en liquidación"
---

# Sección Cuenta bancaria: conciliación, contribuciones y fondo común

## What happened
Ejecución `/ak:cook --auto` del plan `plans/260914-0222-cuenta-bancaria/` (5 fases, rama `feat/v0.16.0` desde develop).

- **Fase 1**: migración `0015` — `bank_transactions`, `contributions` (índice único parcial `(member_id, period) WHERE type='quota'`), `finance_settings` (fila única `global`). Backup previo en `.backups/`. Solo-additiva.
- **Fase 2**: `bank-core.ts` puro (saldo acumulado con orden estable, saldo pre-compra estricto `<`, conciliación, fondo común con división entera determinista, utilidades de período para el adelanto multi-mes, grid de cuotas) + wrappers `bank-service.ts`/`contribution-service.ts`. 25 tests nuevos (55/55).
- **Fase 3**: 14 endpoints `/api/bank/**` + `settlement` extendido de forma additive con `fondoComun` (null para Invitado, mismo criterio que `totalSpentCents`).
- **Fases 4-5**: `/banco` (resumen de 4 tarjetas, lista con saldo acumulado, filtros/paginación en cliente, justificante adjuntable después), `/banco/contribuciones` (grid miembro×mes pagado/pendiente/adelantado, vinculación a depósito) y sección "Saldo con el fondo común" en `/liquidacion`. Componentes en `app/components/bank/`.

Verificación: ~30 escenarios E2E por curl (RBAC owner/guest, multi-mes, transferencia auto-vinculada, duplicados 409, magic bytes, >10MB, fechas), tester en navegador real (admin+guest, responsive 400px) y code-reviewer con informe.

## Decision
- Las cuentas bancarias son **totalmente ajenas** al libro contable: tablas propias, sin puente; un gasto pagado desde la cuenta son dos registros independientes (decisión del plan, no-goal el enlace automático).
- Borrar un aporte **nunca** borra su movimiento vinculado (solo desvincula): distinguir un ingreso auto-creado de uno manual re-vinculado no es fiable, y la alerta "ingresos sin aporte asociado" destaca los huérfanos para borrado explícito del Admin.
- Invitados: 403 directo en POST de contribuciones (antes llegaba al 400 confuso del servicio); ven el agregado de efectivo pendiente pero no la lista con nombres (A1 del review).
- Transferencia = ingreso automático ya vinculado; el justificante va al MOVIMIENTO (ticket bancario), el efectivo no acepta archivo.

## Bugs encontrados por la verificación (y corregidos)
1. `refine` de zod invertido en POST movimientos (rechazaba categoría en depósitos, no en salidas).
2. 9 componentes usados sin prefijo `Bank` en las páginas → páginas sin renderizar (el typecheck no lo detecta porque los componentes no resolvían; el tester en navegador sí).
3. Carrera en adjunto de justificante (409 burlable sin re-check dentro del FOR UPDATE).
4. Fechas imposibles (`2026-02-31`) pasaban el regex → 500 de Postgres.
5. PATCH de fecha podía romper la invariante depósito ≥ aporte.

## Next steps
- 👤 Decidir commit de `feat/v0.16.0` y limpieza de datos de prueba E2E (movimientos/contribuciones/settings + 3 usuarios `verify-bank-*` en BD dev).
- Merge a develop siguiendo la convención del repo; release v0.16.0.
- Señal de rotura documentada: si cambia la membresía (alta/baja a mitad de período), migrar el reparto del fondo común de N fijo a reparto por fecha de movimiento.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
