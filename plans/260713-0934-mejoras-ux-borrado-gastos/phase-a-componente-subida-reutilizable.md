---
phase: A
title: "Componente de subida reutilizable + catálogo de componentes"
status: pending
priority: P1
effort: 3h
---

# Phase A: Componente de subida reutilizable + catálogo

## Context links
- Feedback usuario: "no sé en dónde dar clic para subir imágenes... hay un texto pero no aparece un botón".
- Puntos actuales de subida (todos usan `<input type="file">` desnudo, sin dropzone ni preview): `app/pages/tasks/[id].vue`, `app/pages/gallery.vue`, `app/pages/ideas/[id].vue`, `app/pages/proposals/[id].vue`, `app/pages/expenses/new-from-ticket.vue`, `app/pages/ledger/[id].vue` (comprobante de pago), `app/pages/proposals/[id].vue` (PDF de cotización).

## Requirements
- Componente Vue reutilizable `app/components/media/file-upload.vue` (o similar): zona de arrastrar/soltar visualmente clara + botón "Seleccionar archivo" explícito (nunca solo el input nativo) + preview de la imagen seleccionada antes de subir + validación de tipo/tamaño en cliente (mismo límite que servidor: 10MB, JPEG/PNG; PDF donde aplique) + estado de carga visible.
- Props: `accept` (mime types), `maxSizeMb`, `label`, evento `@upload` con el `File` seleccionado (el componente NO hace la llamada HTTP, cada página sigue controlando su propio `$fetch` — mantiene el patrón actual de responsabilidad por página).
- Página `/dev/components` (protegida, solo `admin`, no listada en el nav principal) que muestra el componente de subida y cualquier otro componente reutilizable relevante en aislamiento, con sus variantes.

## Related code files
- Create: `app/components/media/file-upload.vue`
- Create: `app/pages/dev/components.vue`
- Modify: todas las páginas listadas en Context links, reemplazando `<input type="file">` por el nuevo componente.

## Implementation Steps
1. Crear `file-upload.vue`: dropzone (`@dragover`/`@drop`), input oculto disparado por botón visible, preview con `URL.createObjectURL`, validación cliente de tipo/tamaño con mensaje de error claro.
2. Crear `/dev/components` con el componente en varias configuraciones (imagen, PDF, con/sin preview).
3. Integrar en cada página de subida existente, uno por uno, verificando que el flujo de subida real (POST al endpoint correspondiente) sigue funcionando exactamente igual que antes (el componente solo cambia la UX de selección, no el contrato con el backend).

## Tests / Validation
- Verificación manual en navegador (Chrome devtools) de al menos 2 puntos de subida (galería general y una idea): arrastrar archivo, hacer clic en botón, ver preview, subir, confirmar que aparece en la lista tras refresh.
- `pnpm typecheck && pnpm lint && pnpm test` sin errores nuevos.

## Risks / Rollback
- Riesgo bajo: es un cambio de presentación, no de contrato de API. Si algo falla, revertir el componente y dejar el `<input>` nativo no rompe ningún endpoint.
