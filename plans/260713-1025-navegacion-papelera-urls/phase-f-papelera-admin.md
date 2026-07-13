---
phase: F
title: "Descarte de tareas + papelera Admin + borrado definitivo"
status: pending
priority: P1
effort: 3h
---

# Phase F: Papelera de Admin

## Context links
- Decisión confirmada: el soft-delete (discarded/cancelled) deja de ser visible vía toggle para cualquier usuario — pasa a estar oculto para todos y visible solo para Admin en una papelera dedicada con borrado definitivo.

## Requirements
1. **Tareas**: nueva columna `discardedAt` (timestamp nullable) en `tasks`. Botón "Descartar" en `app/pages/tasks/[id].vue` (Admin o `createdBy`, mismo criterio que ideas). Tareas descartadas se excluyen del kanban (`app/pages/tasks/index.vue`).
2. **Quitar el toggle público**: `app/pages/ideas/index.vue` y `app/pages/proposals/index.vue` dejan de mostrar el checkbox "mostrar descartadas/canceladas" — esos elementos quedan simplemente ocultos del listado normal para todos los roles.
3. **Papelera de Admin** (`/admin/trash`, middleware `admin`): agrega ideas `discarded`, propuestas `cancelled` y tareas con `discardedAt` no nulo. Por cada elemento: título, tipo, fecha de descarte, botón "Eliminar definitivamente".
4. **Borrado definitivo** (hard delete real, solo Admin):
   - `DELETE /api/ideas/[id]` — solo si `status='discarded'`.
   - `DELETE /api/proposals/[id]` — solo si `status='cancelled'`.
   - `DELETE /api/tasks/[id]` — solo si `discardedAt` no nulo.
   - Los tres auditan (`writeAuditLog`, action `*_deleted_permanently`) ANTES del borrado (si se audita después, la fila de auditoría quedaría con un `entityId` de algo que ya no existe — aceptable ya que `audit_log.entityId` no tiene FK real, pero mejor loguear antes por claridad temporal).
   - Cascada ya cubierta por FKs existentes (`media.taskId/ideaId/proposalId`, `quotes.proposalId`, `votes.proposalId` ya tienen `onDelete: cascade`).

## Related code files
- Modify: `server/db/schema/tasks.ts` (+ migración `discardedAt`)
- Create: `server/api/tasks/[id]/discard.post.ts`
- Modify: `server/api/tasks/index.get.ts` (excluir descartadas)
- Create: `server/api/ideas/[id].delete.ts`, `server/api/proposals/[id].delete.ts`, `server/api/tasks/[id].delete.ts`
- Create: `server/api/admin/trash.get.ts` (agregación de los 3 tipos)
- Create: `app/pages/admin/trash.vue`
- Modify: `app/pages/ideas/index.vue`, `app/pages/proposals/index.vue` (quitar toggle), `app/pages/tasks/index.vue` (excluir descartadas), `app/pages/tasks/[id].vue` (botón Descartar)

## Tests / Validation
- curl: descartar una tarea, verificar que desaparece del kanban pero aparece en `/api/admin/trash`.
- curl: borrado definitivo de una idea descartada → 200, ya no existe en BD (verificar con psql). Intentar borrar definitivamente una idea NO descartada → 400.
- curl: un `owner` (no admin) intenta acceder a `/api/admin/trash` o a cualquier DELETE definitivo → 403.

## Risks / Rollback
- Hard delete es irreversible — mitigado por el propio diseño (solo alcanzable tras pasar primero por soft-delete, y solo Admin). Cascadas ya probadas en fases anteriores (Fase 7/8/9 para `media`, Fase 6 para `quotes`/`votes`).
