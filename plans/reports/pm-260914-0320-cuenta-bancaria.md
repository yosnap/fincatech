# PM Report — Cuenta bancaria: conciliación, contribuciones y fondo común

- **Fecha:** 2026-09-14 03:2x
- **Plan:** `plans/260914-0222-cuenta-bancaria/` (status: completed)
- **Rama:** `feat/v0.16.0` (desde develop, sin commitear aún)
- **Modo:** `/ak:cook --auto` (5 fases, ejecución continua)

## Resumen de fases

| # | Fase | Status | Verificación |
|---|------|--------|--------------|
| 1 | Esquema BD + migración 0015 | Implemented | Backup previo; tablas e índice único parcial verificados en BD |
| 2 | Servicios (bank-core puro + wrappers) | Implemented | 25 tests nuevos de bank-core (55/55 totales) |
| 3 | Endpoints /api/bank/** + settlement extendido | Implemented | ~30 escenarios E2E por curl |
| 4 | UI /banco (resumen + movimientos) | Implemented | Tester en navegador (admin + guest, responsive 400px) |
| 5 | UI /banco/contribuciones + fondo común en liquidación | Implemented | Tester en navegador (admin + guest) |

## Gates

- `pnpm test`: 55/55 ✓ · `pnpm typecheck`: 0 errores ✓ · `pnpm lint`: 0 ✓ · `pnpm build`: ✓
- Migración aplicada con backup previo (`.backups/pre-0015-cuenta-bancaria-20260914-023957.sql`)

## Bugs detectados y corregidos durante la verificación

| Origen | Bug | Fix |
|---|---|---|
| E2E curl | `refine` zod invertido: rechazaba categoría en depósitos en vez de en salidas | Corregido |
| E2E curl | Borrado de aporte transfer destruía movimientos manuales re-vinculados | Simplificado: borrado solo desvincula; alerta de conciliación destaca huérfanos |
| Tester UI | 9 componentes referenciados sin prefijo `Bank` → páginas sin renderizar | Prefijos aplicados |
| Tester UI | Botón "Registrar aporte" visible para Invitado | `v-if="!isGuest"` |
| Reviewer | A1 (Alto): summary filtraba `cashPending` con nombres a Invitado | Lista gateada por `canSeeIndividualDebt` (agregado visible) |
| Reviewer | M1: POST contribuciones aceptaba guest → 400 confuso | 403 claro en endpoint (admin/owner) |
| Reviewer | M2: carrera en adjunto de justificante (409 burlable) | Re-check con FOR UPDATE dentro de la tx |
| Reviewer | M3: PATCH de fecha rompía invariante depósito ≥ aporte | Revalidación en el servicio |
| Reviewer | M4: fechas imposibles (`2026-02-31`) → 500 de Postgres | `isValidCalendarDate` en bank-core + zod en 4 endpoints |
| Reviewer | Icono `i-lucide-search-question` inexistente | Sustituido por `circle-help` |
| Reviewer (bajos) | Tope importe (int4), audit settings fuera de tx, refresh sin movimientos, comentario obsoleto | Corregidos |

No corregidos (decisión documentada): params no-uuid → 500 (patrón preexistente del repo); skew del fondo común con miembros dados de baja (decisión de producto del plan, N = activos actuales).

## Informes de subagentes

- Tester: `plans/reports/e2e-banco-admin.png`, `plans/reports/e2e-contribuciones-admin.png` (re-verificación final: DONE, sin fallos de código restantes)
- Code-reviewer: `plans/reports/code-reviewer-260914-cuenta-bancaria.md` (0 críticos tras fixes; A1 y M1–M4 resueltos)

## Docs impact

- `docs/system-architecture.md`: entrada nueva (2026-09-14) documentando el módulo completo.

## Pendiente de decisión del usuario

1. ¿Commit de la rama feat/v0.16.0? (conventional commit propuesto: `feat(bank): sección cuenta bancaria con conciliación, contribuciones y fondo común`)
2. Datos de prueba E2E en la BD dev: limpiar (movimientos, contribuciones, settings y 3 usuarios temporales `verify-bank-*`) o conservar para explorar la UI.
3. Procesos de verificación arrancados (dev server :3001, contenedor postgres temporal :5455, MinIO) — detener al cerrar.

## Unresolved questions

- Ninguna de producto (todas cerradas en brainstorm/validación del plan).
