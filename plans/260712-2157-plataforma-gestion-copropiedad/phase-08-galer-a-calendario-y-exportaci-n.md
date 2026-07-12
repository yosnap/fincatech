---
phase: 8
title: "Galería, calendario y exportación fiscal"
status: pending
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
- **Estado de implementación:** Pendiente
- **Estado de revisión:** No revisado

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
- [ ] Galería timeline reutilizando `media`
- [ ] reservations con EXCLUDE gist anti-solape
- [ ] Endpoints + UI de calendario con bloqueo por orden de llegada
- [ ] export-service CSV + PDF por rango
- [ ] Export respeta RBAC (guest agregados)
- [ ] Nota de alcance limitado + confirmación con gestoría documentada

## Success Criteria
- [ ] Galería muestra fotos del inmueble en orden cronológico, filtrable.
- [ ] Reservar un rango que solapa con otro se rechaza (a nivel DB, verificado por test).
- [ ] Export CSV y PDF de un rango contienen los gastos/pagos correctos.
- [ ] Export para Invitado no incluye desglose de deuda individual.
- [ ] La UI y docs indican explícitamente que el export no es formato fiscal certificado.

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

## Next steps
Cierra Roadmap F4 y el alcance planificado. Antes de implementar: resolver las 2 Preguntas Abiertas del `plan.md` (formato fiscal, límites de archivo). Posible fase futura opcional: WhatsApp Business API (ver Fase 5).
