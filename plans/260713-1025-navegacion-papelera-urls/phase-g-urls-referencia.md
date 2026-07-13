---
phase: G
title: "URLs de referencia en ideas/propuestas/tareas"
status: pending
priority: P1
effort: 2h
---

# Phase G: URLs de referencia

## Requirements
- Nueva tabla `reference_links`: `id`, `entityType` ('idea'|'proposal'|'task'), `entityId`, `url`, `label` (nullable), `addedBy`, `createdAt`. Polimórfica por `entityType`+`entityId` (sin FK real cruzada, igual que `winningQuoteId` en propuestas — se valida en aplicación).
- Endpoints: `POST/GET/DELETE /api/{ideas|proposals|tasks}/[id]/links` — añadir (admin/owner), listar (todos), borrar (quien lo añadió o Admin).
- Validación de URL: debe ser `http://` o `https://` válida (zod `.url()`), sin restricción de dominio (el usuario pidió explícitamente TikTok, Facebook, imágenes, etc.).
- UI: sección "Enlaces" en las 3 páginas de detalle — lista de enlaces con su label (o la URL si no hay label), cada uno abre en pestaña nueva (`target="_blank" rel="noopener noreferrer"`); formulario para añadir (URL + label opcional); botón de borrar junto a cada enlace propio o si eres Admin.

## Related code files
- Create: `server/db/schema/reference-links.ts` (+ migración)
- Create: `server/api/ideas/[id]/links/index.get.ts`, `index.post.ts`, `[linkId].delete.ts` (y equivalentes para `proposals`, `tasks` — o un único endpoint genérico parametrizado por tipo si el patrón es idéntico, evaluar en implementación)
- Modify: `app/pages/ideas/[id].vue`, `app/pages/proposals/[id].vue`, `app/pages/tasks/[id].vue`

## Security Considerations
- `rel="noopener noreferrer"` obligatorio en los enlaces `target="_blank"` (evita que la pestaña nueva pueda manipular `window.opener` de la pestaña original — tabnabbing).
- No se hace ningún fetch/preview server-side de la URL (SSRF): se guarda y se muestra tal cual, el navegador del usuario es quien la abre.

## Tests / Validation
- curl: añadir una URL válida a una idea → 200. Añadir una URL malformada (`no-es-url`) → 400.
- Verificar que el enlace aparece en el listado de la idea con su label, y que un usuario que no la añadió (ni es Admin) no puede borrarla (403).

## Risks / Rollback
- Riesgo bajo: tabla nueva sin dependencias de otras fases, sin tocar schema existente.
