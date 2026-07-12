---
phase: 7
title: "Derramas, tareas y evidencia fotográfica"
status: pending
priority: P2
effort: 12h
dependencies: [6]
roadmap: "F3 · Gobernanza y operaciones"
---

# Phase 7: Derramas, tareas y evidencia fotográfica

## Context links
- PRD §4.3 (derramas), §4.4 (tareas + fotos antes/después), §4.6 (fotos por tarea) — `docs/prd.md`
- Motor de deudas — `phase-03-contabilidad-gastos-y-divisi-n-de-deudas.md`

## Overview
- **Fecha:** 2026-07-12
- **Descripción:** Al aprobarse una propuesta (Fase 6), generar automáticamente y en una sola transacción: una **Derrama oficial** (coste ganador repartido entre TODOS los copropietarios como deuda urgente, reutilizando el motor de Fase 3) y una **Tarea de ejecución** vinculada. Módulo de tareas completo (`Por Hacer→En Progreso→Completado`) con evidencia fotográfica Antes/Después.
- **Prioridad:** P2
- **Estado de implementación:** Pendiente
- **Estado de revisión:** No revisado

## Key Insights
- La derrama reutiliza `debt-splitter`/`expense-service` de Fase 3 pero difiere del gasto normal: se reparte entre **todos** (N, no N-1) porque nadie ha adelantado el dinero aún. El acreedor es el usuario sistema "fondo común" ya modelado en Fase 3 (`users` con rol `fondo`) — no redefinir aquí, solo consumirlo.
- **Atomicidad crítica:** aprobación → derrama + tarea debe ser una TX única. Si se crea la derrama pero falla la tarea (o al revés), queda estado inconsistente. Idempotente: aprobar una propuesta ya ejecutada no duplica derrama/tarea.
- Tareas también se crean manualmente (no solo desde propuestas).
- Fotos por tarea (Antes/Después) y galería general (Fase 8) comparten un **repositorio de medios único** filtrable por tarea/fecha/tipo → definir aquí el schema de `media` que Fase 8 reutiliza.
- Notificación de "nueva deuda (derrama)" y "tarea asignada" se enruta por Fase 5.

## Requirements
- **Funcional:** al cerrar propuesta aprobada → generar derrama (deuda a todos) + tarea de ejecución vinculada; CRUD tareas (título, desc, asignado, fecha límite, prioridad); transición de estados; adjuntar fotos Antes/Después; asignar/marcar completada.
- **No funcional:** generación derrama+tarea atómica e idempotente; auditoría; validación de archivos de foto (provisional: máx 10MB, JPEG/PNG).

## Architecture
```
proposal 'Aprobada' (Fase 6) ── executeApprovedProposal(proposal) ── TX
  ├ guard idempotente: ¿ya tiene derrama? → no-op
  ├ crea Derrama (expense tipo 'derrama', reparto entre TODOS, acreedor=fondo común)
  │   → reutiliza debt-splitter (Fase 3) generando debts urgentes
  ├ crea Task 'Por Hacer' vinculada (proposal_id)
  ├ audit_log
  └ COMMIT → notification-service enqueue (Fase 5)

Task ── media[] (tipo: 'antes'|'despues')  ── repositorio 'media' compartido con Fase 8
```

## Related code files
- Create: `server/db/schema/tasks.ts` (tasks), `server/db/schema/media.ts` (media compartido)
- Create: `server/services/assessment-service.ts` (executeApprovedProposal: derrama+tarea en TX)
- Create: `server/services/task-service.ts`
- Create: `server/api/tasks/*`, `server/api/tasks/[id]/media.post.ts`
- Create: `app/pages/tasks/*`, `app/components/task/*` (form, kanban de estados, subida foto antes/después)
- Modify: `server/services/proposal-service.ts` (invocar execute tras cierre aprobado)
- Modify: `server/db/schema/expenses.ts` (tipo `derrama`, reparto entre todos)

## Implementation Steps
1. Schema `tasks` (título, desc, assignee, due_date, prioridad, estado, proposal_id?) y `media` (owner_type task|gallery, task_id?, tipo antes|despues|general, archivo, autor, fecha).
2. `assessment-service.executeApprovedProposal`: TX que crea derrama (reparto entre todos, acreedor fondo común) + tarea vinculada; guard idempotente.
3. Enganchar: al cerrar propuesta `Aprobada` (Fase 6) invocar execute dentro de la misma TX o en TX consecutiva idempotente.
4. `task-service`: CRUD, transición de estados, asignación.
5. Subida de fotos Antes/Después a `media` vinculadas a la tarea — comprimir en cliente, validar tipo/tamaño (10MB, JPEG/PNG), subir a MinIO vía `storage.ts` (Fase 1).
6. Notificar nueva derrama + tarea asignada vía Fase 5 (enqueue).
7. UI: lista/kanban de tareas, detalle con evidencia Antes/Después.

## Todo list
- [ ] Schema tasks + media (repositorio compartido con Fase 8)
- [ ] executeApprovedProposal: derrama+tarea en TX única e idempotente
- [ ] Reparto de derrama entre TODOS + acreedor fondo común definido
- [ ] Enganche con cierre de propuesta (Fase 6)
- [ ] CRUD tareas + transición de estados + asignación
- [ ] Fotos Antes/Después vinculadas a tarea
- [ ] Notificaciones de derrama y tarea (Fase 5)

## Success Criteria
- [ ] Aprobar una propuesta genera exactamente una derrama y una tarea (idempotente ante reintento).
- [ ] La derrama reparte el coste ganador entre todos los copropietarios como deuda.
- [ ] Fallo al crear la tarea revierte también la derrama (atomicidad verificada).
- [ ] Una tarea admite fotos etiquetadas Antes y Después, filtrables.
- [ ] Cambios de estado de tarea quedan auditados.

## Risk Assessment
| Riesgo | Prob×Impacto | Mitigación |
|--------|--------------|------------|
| **Derrama sin tarea (o viceversa) por fallo parcial** | Media×Alto | Generación en TX única; rollback atómico; test de fallo a mitad |
| Doble ejecución duplica derrama/tarea | Media×Alto | Guard idempotente por `proposal_id`; check `winning_quote_id` ya ejecutado |
| Reparto de derrama mal modelado (N-1 vs N, acreedor) | Media×Alto | Definir explícito: reparto entre todos, acreedor fondo común; tests dedicados |
| Divergencia schema media vs Fase 8 | Baja×Medio | Definir `media` genérico aquí; Fase 8 solo añade vista galería |

## Security Considerations
- Solo Admin/autor dispara la ejecución (heredado de cierre Fase 6).
- Validar fotos (10MB tras compresión, JPEG/PNG); almacenadas en MinIO (bucket privado, URL firmada).
- Guest: lectura de tareas/fotos agregadas, sin acción; sin desglose de deuda de la derrama.
- Auditar creación de derrama, tarea y cambios de estado.

## Next steps
Cierra Roadmap F3. Fase 8: extras — galería general, calendario y exportación.
