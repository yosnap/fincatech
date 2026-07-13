---
phase: B
title: "Borrado/descarte de ideas y propuestas"
status: pending
priority: P1
effort: 2h
---

# Phase B: Borrado/descarte de ideas y propuestas

## Context links
- Feedback usuario: "cómo puedo eliminarlas si no me gustó, si no funcionó [una idea o propuesta]".
- Decisión confirmada: soft-delete vía estado, no DELETE físico. Admin o autor original.
- `ideas.status` ya tiene `discarded` (`server/db/schema/governance.ts`) y endpoint `PATCH /api/ideas/[id]/status` ya lo soporta (Fase 6) — falta solo permitir accionarlo desde la UI para el autor, y ocultarlas por defecto de la lista.
- `proposals.status` solo tiene `voting`|`approved` — falta un tercer estado.

## Requirements
- **Propuestas:** nuevo estado `cancelled`. Endpoint `POST /api/proposals/[id]/cancel` (o extender `close`) — solo Admin o autor, solo si `status === 'voting'` (no se puede cancelar una ya aprobada, tiene derrama/tarea generada). Auditar (`writeAuditLog`, action `proposal_cancelled`).
- **Ideas:** ya soportado por `PATCH /api/ideas/[id]/status` con `status: 'discarded'` — verificar que el RBAC actual permite autor (no solo Admin) y si no, corregirlo.
- **UI:** botón "Descartar"/"Cancelar" visible en `app/pages/ideas/[id].vue` y `app/pages/proposals/[id].vue` para quien tenga permiso, con confirmación (`UModal` o `confirm()` simple, evitar borrado accidental).
- **Listados:** `app/pages/ideas/index.vue` y `app/pages/proposals/index.vue` ocultan por defecto las descartadas/canceladas, con un toggle "Mostrar descartadas" para verlas.

## Related code files
- Modify: `server/db/schema/governance.ts` (comentario del enum de `proposals.status`, no requiere migración — es un `text` sin CHECK)
- Create: `server/api/proposals/[id]/cancel.post.ts`
- Modify: `server/api/ideas/[id]/status.patch.ts` (revisar RBAC autor)
- Modify: `app/pages/ideas/[id].vue`, `app/pages/proposals/[id].vue`, `app/pages/ideas/index.vue`, `app/pages/proposals/index.vue`

## Tests / Validation
- curl: autor de una propuesta en 'voting' la cancela → 200, status pasa a 'cancelled'. Un no-autor no-admin intenta cancelar → 403. Intentar cancelar una ya 'approved' → 400/409.
- Verificar que una propuesta cancelada no aparece en el listado por defecto pero sí con el toggle activado.

## Risks / Rollback
- Riesgo bajo: nuevo estado de texto libre, no rompe filas existentes. Si se decide revertir, basta con quitar el endpoint y el botón de UI — el estado `cancelled` no tiene FKs ni triggers dependientes.
