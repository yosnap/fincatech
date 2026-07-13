---
title: "Navegación de vuelta, papelera admin con borrado definitivo, URLs de referencia"
status: completed
priority: P1
effort: 6h
branch: develop
tags: [ux, governance, tasks]
created: 2026-07-13
createdBy: "sesión de continuación tras mejoras-ux-borrado-gastos"
source: feedback directo del usuario
---

# Navegación, papelera y URLs de referencia

## Overview

Segunda tanda de feedback tras revisar las mejoras UX anteriores: falta navegación de "volver" en pantallas de detalle, el soft-delete de ideas/propuestas debería ocultarse de TODOS los usuarios (no un toggle visible a cualquiera) y ser visible solo en una papelera de Admin con opción de borrado definitivo desde ahí, tareas necesitan la misma capacidad de descarte que ideas/propuestas, y se necesitan URLs de referencia (múltiples, abren en pestaña nueva) en ideas/propuestas/tareas.

## Decisiones confirmadas con el usuario

- **Visibilidad del soft-delete:** cambia de "toggle visible para cualquiera" (como se implementó antes) a "oculto para todos, visible solo para Admin en una papelera dedicada". El toggle "mostrar descartadas/canceladas" en los listados públicos se elimina.
- **Papelera de Admin:** una vista (`/admin/trash`) que agrega ideas descartadas + propuestas canceladas + tareas descartadas (nuevo), con botón "Eliminar definitivamente" (hard delete real) por elemento.
- **Tareas:** necesitan la misma capacidad de "descartar" que ya tienen ideas/propuestas — nuevo campo `discardedAt` (no se reutiliza el `status` de workflow todo/in_progress/done, para no romper el kanban).
- **Botón volver:** en TODAS las pantallas de detalle (tareas, ideas, propuestas, gasto/ledger), enlace explícito al listado padre (no `router.back()`, para que sea predecible incluso si se llegó por enlace directo).
- **URLs de referencia:** lista de varias URLs por idea/propuesta/tarea, cualquier admin/owner puede añadir, con texto descriptivo opcional, se abren en pestaña nueva (`target="_blank"`).

## Phases

| Phase | Name | Status |
|-------|------|--------|
| E | [Botón volver en pantallas de detalle](./phase-e-boton-volver.md) | Implemented |
| F | [Descarte de tareas + papelera Admin + borrado definitivo](./phase-f-papelera-admin.md) | Implemented |
| G | [URLs de referencia en ideas/propuestas/tareas](./phase-g-urls-referencia.md) | Implemented |

## Orden de ejecución

E (independiente, rápida) → F → G. F debe ir antes que el cierre general porque cambia el comportamiento de visibilidad ya entregado (quita el toggle "mostrar descartadas").

## Nota de implementación (post-hoc)

**Hallazgos de code review corregidos:**
- **Crítico:** `GET /api/ideas` y `GET /api/proposals` seguían devolviendo elementos descartados/cancelados sin filtrar — el ocultamiento solo existía como `.filter()` en el frontend (cosmético, no seguridad real). Corregido con `where: ne(status, 'discarded'|'cancelled')` server-side en ambos endpoints; el `.filter()` del frontend se eliminó por redundante.
- **Alto:** las URLs de referencia (Fase G) no restringían esquema — `zod().url()` aceptaba `javascript:`/`data:` pese a que el plan exigía explícitamente http(s). Corregido con `.refine()` + regex en un schema compartido (`referenceLinkBodySchema` en `reference-link-service.ts`) usado por los 3 endpoints.
- **Alto:** los 3 endpoints de borrado definitivo (`ideas/proposals/tasks [id].delete.ts`) no eran transaccionales — el guard de estado previo no tenía lock de fila, y la auditoría se escribía antes del borrado sin transacción (riesgo de log falso si el delete fallaba después). Corregido: todo dentro de `db.transaction()` con `.for('update')`, auditoría con el executor `tx`.
- **Medio:** `PATCH /api/tasks/[id]/status` no bloqueaba cambios de estado en una tarea ya descartada. Corregido con guard explícito + UI que oculta los botones de estado y muestra un aviso cuando `discardedAt` no es nulo.
- **Medio:** fallback `closedAt ?? updatedAt` en la papelera para propuestas canceladas, que podía enmascarar una fecha incorrecta si el invariante cambiara en el futuro. Simplificado a solo `closedAt` (siempre se rellena al cancelar), documentado el porqué en el código.

**Refactor no solicitado por el review pero motivado por feedback directo del usuario durante esta misma sesión:** `PhotoUpload.vue` (Fase A/mejoras UX anteriores) se dividió en `FilePicker.vue` (selector puro: dropzone + preview + validación, sin subida) y `PhotoUpload.vue` (FilePicker + botón "Subir" + orquestación HTTP). Esto permitió migrar también `app/pages/expenses/new-from-ticket.vue` (subida de ticket para OCR) y el formulario de PDF de cotización en `app/pages/proposals/[id].vue` — ambos habían quedado con `<input type="file">` desnudo en la tanda anterior porque no encajaban con el modelo "selecciona y sube inmediatamente" del componente original. Con `FilePicker` como pieza separada, ambos casos (archivo como paso intermedio de un flujo multi-paso, archivo como campo más de un formulario) quedan cubiertos sin duplicar código. El catálogo `/dev/components` se amplió para mostrar ambos componentes más los patrones de botones/formularios/alertas ya existentes en la app, como referencia visual única.
