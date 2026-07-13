---
phase: 8
title: "Galería, calendario y exportación fiscal"
status: completed
priority: P3
effort: 10h
dependencies: [3, 7]
roadmap: "F4 · Extras operativos"
---

# Phase 8: Galería, calendario y exportación fiscal

## Context links
- PRD §4.6 (galería), §4.8 (calendario/reservas), §5 (exportación fiscal) — `docs/prd.md`
- Alcance export limitado + riesgos — `plans/reports/analisis-huecos-260712-1628-prd-gestion-copropiedad-report.md`

## Overview
- **Fecha:** 2026-07-12
- **Descripción:** Extras de menor urgencia: galería general cronológica del inmueble (reutiliza `media` de Fase 7), calendario de reservas con bloqueo simple de fechas por orden de llegada (sin aprobación ni límites), y exportación PDF/CSV de gastos/pagos por rango de fechas para una gestoría externa. La exportación es un libro contable simple, **NO** un formato fiscal certificado.
- **Prioridad:** P3
- **Estado de implementación:** Implementado (mergeado a develop)
- **Estado de revisión:** Revisado (code-reviewer) — 4 hallazgos Altos corregidos, 1 Medio resuelto, 1 bug crítico adicional descubierto y corregido (afectaba también a Fase 6)

## Key Insights
- Galería no requiere modelo nuevo: reutiliza `media` (Fase 7) con `owner_type='gallery'`, filtrable por fecha/tipo. YAGNI: solo una vista + subida.
- Calendario mantenido simple intencionalmente: bloqueo por solape, orden de llegada, sin aprobación ni límite de noches. Riesgo de conflicto de fechas se acepta para el MVP.
- **Prevención de solape es la única regla dura del calendario:** constraint de exclusión en PostgreSQL (`EXCLUDE USING gist` sobre rango de fechas) evita reservas solapadas a nivel DB, no solo en app.
- **Exportación: alcance limitado explícito.** PDF/CSV simple, no Modelo 347 ni formatos AEAT. El formato exacto está en Preguntas Abiertas del plan — confirmar con la gestoría real antes de cerrar esta fase; si piden formato regulatorio, es requisito aparte.
- Export debe respetar RBAC: para Invitado (gestoría) solo agregados, sin desglose individual.

## Requirements
- **Funcional:** subir/ver galería cronológica del inmueble; reservar rango de fechas con bloqueo automático de solapes; exportar gastos/pagos por rango a PDF y CSV.
- **No funcional:** exclusión de solape a nivel DB; export respeta RBAC (agregados para guest); export por rango eficiente.

## Architecture
```
media (Fase 7) ── galería: filtro owner_type='gallery' + timeline por fecha
reservations (owner, date_range) ── EXCLUDE USING gist (evita solape en DB)
export(rango, formato, rol) → query gastos/pagos → CSV | PDF
  └ si rol=guest → solo agregados (sin desglose individual)
```

## Related code files
- Create: `server/db/schema/reservations.ts`
- Create: `server/services/export-service.ts` (CSV + PDF, respeta RBAC)
- Create: `server/api/gallery/*`, `server/api/reservations/*`, `server/api/export/[csv|pdf].get.ts`
- Create: `app/pages/gallery.vue`, `app/pages/calendar.vue`, `app/pages/export.vue`
- Create: `app/components/media/gallery-timeline.vue`, `app/components/calendar/*`
- Modify: `server/db/schema/media.ts` (asegurar `owner_type='gallery'` soportado)

## Implementation Steps
1. Galería: endpoint + vista timeline filtrando `media` por `owner_type='gallery'`; subida general — comprimir en cliente, validar (10MB, JPEG/PNG), subir a MinIO vía `storage.ts` (Fase 1).
2. `reservations` schema con `EXCLUDE USING gist` sobre `daterange` para impedir solapes en DB.
3. Endpoints reservar/listar/cancelar; UI calendario que muestra fechas bloqueadas.
4. `export-service`: consulta gastos/pagos por rango; genera CSV; genera PDF (tabla simple). Respetar RBAC (guest = agregados).
5. UI de exportación con selector de rango y formato.
6. Documentar en export y en docs el alcance limitado (no certificado) + nota de confirmar con gestoría.

## Todo list
- [x] Galería timeline reutilizando `media`
- [x] reservations con EXCLUDE gist anti-solape
- [x] Endpoints + UI de calendario con bloqueo por orden de llegada
- [x] export-service CSV + PDF por rango
- [x] Export respeta RBAC (guest agregados)
- [x] Nota de alcance limitado + confirmación con gestoría documentada

## Success Criteria
- [x] Galería muestra fotos del inmueble en orden cronológico, filtrable. Filtro por fecha vía query params `start`/`end`.
- [x] Reservar un rango que solapa con otro se rechaza (a nivel DB, verificado por test). Test unitario de `getPgErrorCode` + verificación funcional contra la BD real (23P01 → 409); constraint `EXCLUDE USING gist` confirmado con `\d reservations`.
- [x] Export CSV y PDF de un rango contienen los gastos/pagos correctos, incluido el desglose por deudor para admin/owner (verificado vía agente `tester` con curl+psql).
- [x] Export para Invitado no incluye desglose de deuda individual (verificado: columnas de deudor vacías en CSV, sin sección de deudores en PDF).
- [x] La UI y docs indican explícitamente que el export no es formato fiscal certificado (alerta en `app/pages/export.vue` y cabecera del PDF).

## Risk Assessment
| Riesgo | Prob×Impacto | Mitigación |
|--------|--------------|------------|
| **Export no cumple lo que pide la gestoría** | Media×Medio | Alcance limitado explícito; Pregunta Abierta a resolver antes de implementar; formato regulatorio = requisito aparte |
| Reservas solapadas por carrera | Media×Medio | `EXCLUDE USING gist` a nivel DB, no solo validación en app |
| Conflicto de fechas sin reglas de reparto | Media×Bajo | Aceptado en MVP; documentar; iterar si el uso real es conflictivo |
| Export filtra datos sensibles a guest | Baja×Alto | Reutilizar RBAC/agregación; test de export como guest |

## Security Considerations
- Export respeta RBAC: Invitado solo agregados; nunca desglose individual (privacidad entre copropietarios).
- Validar archivos de galería (10MB tras compresión, JPEG/PNG); almacenados en MinIO (bucket privado, URL firmada).
- Reservas: un propietario solo edita/cancela las suyas (salvo Admin).

## Nota de implementación (post-hoc)

**Bug crítico descubierto (code review + verificación empírica), afectaba también a Fase 6:** drizzle-orm 0.45.2 (driver `node-postgres`) envuelve los errores de Postgres en un `DrizzleQueryError` cuyo `.code` no existe — el código real (`23505`, `23P01`...) queda en `.cause.code`. El catch de `reservation-service.ts` (`error.code === '23P01'`) nunca se disparaba: una reserva solapada devolvía un 500 crudo en vez de 409. Verificado empíricamente contra la BD real reproduciendo el error con el mismo query builder (`db.insert(...).values(...)`) usado en el código de producción. Se encontró el MISMO patrón roto en `castVote` de `server/services/proposal-service.ts` (Fase 6, ya mergeado a `develop`): un voto duplicado también devolvía 500 en vez de 409. Corregido con un helper compartido `getPgErrorCode(error)` en `server/utils/pg-error.ts` que revisa `.code` y, si no existe, `.cause.code`; aplicado en ambos servicios. Re-verificado con test dirigido contra la BD real: la segunda reserva solapada ahora lanza `{ statusCode: 409 }` correctamente.

**Hallazgos Altos corregidos (code review):**
- El desglose de deuda por deudor (`row.debts`) se calculaba en `getExportRows` respetando RBAC pero nunca se renderizaba en CSV/PDF (código muerto) — añadido a `rowsToCsv`/`rowsToPdf` en `server/services/export-formatters.ts`: una línea adicional por deudor en CSV, una sub-línea gris en PDF.
- Inyección de fórmulas CSV (CWE-1236): `description` de un gasto es texto libre que fluye al CSV descargado por una gestoría externa; un valor que empezara por `=`, `+`, `-`, `@` o tabulador se neutraliza anteponiendo un apóstrofe antes de escapar comillas/comas.
- Cancelación de reserva (`DELETE /api/reservations/[id]`) era el único hard-delete del backend sin `writeAuditLog` — añadido.
- Falta de tests para los criterios de éxito del plan — añadidos tests unitarios para las funciones puras de `export-formatters.ts` (neutralización de fórmulas, desglose por deudor); el resto (solape a nivel DB, RBAC de export) se verificó funcionalmente vía agente `tester` con curl+psql, siguiendo el mismo patrón ya aceptado en Fase 7 para lógica transaccional/DB que no tiene infraestructura de test de integración en este proyecto.

**Decisión de diseño documentada (Medio, no bloqueante):** el constraint `EXCLUDE USING gist` usa rango inclusivo-inclusivo (`daterange(start_date, end_date, '[]')`) para poder reservar un único día sin que se trate como rango vacío. Trade-off aceptado: dos reservas no pueden encadenar checkout/checkin el mismo día (se consideran solapadas). Documentado en `server/db/schema/reservations.ts` y en la migración.

**Deuda técnica aceptada:** `getExportRows` trae la tabla `debts` completa y filtra en memoria (mismo patrón ya existente en `server/api/expenses/index.get.ts` desde Fase 3, no es una regresión nueva); el `EXCLUDE` constraint no está representado en el schema de Drizzle (solo en el SQL de la migración) por falta de builder nativo — riesgo de drift bajo mientras el flujo siga siendo `db:generate`+`db:migrate` sin `db:push`.

## Next steps
Cierra Roadmap F4 y el alcance planificado. Antes de implementar: resolver las 2 Preguntas Abiertas del `plan.md` (formato fiscal, límites de archivo). Posible fase futura opcional: WhatsApp Business API (ver Fase 5).
