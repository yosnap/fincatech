---
phase: C
title: "Borrado de fotos individuales (galería, tareas, ideas, propuestas)"
status: pending
priority: P2
effort: 1.5h
---

# Phase C: Borrado de fotos individuales

## Context links
- Feedback usuario: "cómo puedo eliminar archivos".
- Hallazgo de code review previo (Fase de galería en ideas/propuestas): no existe NINGÚN endpoint DELETE para `media` en todo el proyecto — es borrado real de archivo (no aplica el mismo criterio de soft-delete que ideas/propuestas, una foto subida por error no necesita quedar en auditoría).
- `server/services/storage.ts` ya expone `deleteFile(objectName)`, sin usar todavía.

## Requirements
- Endpoint `DELETE /api/media/[id]` genérico (funciona para fotos de tarea, galería, idea o propuesta, ya que `media` es polimórfica) — solo quien subió la foto (`uploadedBy`) o Admin puede borrarla. Borra el objeto real en MinIO (`deleteFile`) Y la fila en `media`.
- Auditar el borrado (`writeAuditLog`, action `media_deleted`).
- UI: botón de borrar (icono papelera) junto a cada foto en `app/pages/gallery.vue`, `app/pages/tasks/[id].vue`, `app/pages/ideas/[id].vue`, `app/pages/proposals/[id].vue`, con confirmación.

## Related code files
- Create: `server/api/media/[id].delete.ts`
- Modify: `app/pages/gallery.vue`, `app/pages/tasks/[id].vue`, `app/pages/ideas/[id].vue`, `app/pages/proposals/[id].vue`

## Tests / Validation
- curl: quien subió la foto la borra → 200, ya no aparece en el listado ni la URL firmada resuelve (404). Otro owner (no autor de la subida, no admin) intenta borrar → 403.
- Verificar en MinIO (o vía `objectExists()`) que el objeto real desaparece, no solo la fila de la BD.

## Risks / Rollback
- Es borrado físico real (no soft-delete) — irreversible una vez confirmado. Mitigado con confirmación explícita en UI antes de llamar al endpoint.
