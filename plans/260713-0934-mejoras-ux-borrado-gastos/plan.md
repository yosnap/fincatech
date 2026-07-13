---
title: "Mejoras UX: subida de fotos, borrado de ideas/propuestas, central de gastos"
status: completed
priority: P1
effort: 10h
branch: develop
tags: [ux, ui-components, governance, expenses]
created: 2026-07-13
createdBy: "sesión de continuación post-plan-8-fases"
source: feedback directo del usuario
---

# Mejoras UX post-lanzamiento

## Overview

Feedback directo del usuario tras revisar la app completa (8 fases + galería en ideas/propuestas): la subida de fotos no es usable para usuarios no técnicos, faltan formas de eliminar/descartar ideas y propuestas, y falta una vista centralizada de gastos (pendiente de pagar, historial por periodo, totales del fondo común).

No es una fase nueva del roadmap del PRD — es trabajo correctivo/UX sobre lo ya construido, priorizado porque afecta el uso diario real de la familia.

## Decisiones confirmadas con el usuario

- **Borrado de ideas/propuestas:** soft-delete vía estado (`discarded` en ideas, ya existe; `cancelled` nuevo en propuestas), no DELETE físico — preserva auditoría, evita romper FKs de comentarios/cotizaciones/votos/fotos.
- **Permisos de borrado:** Admin o el autor original.
- **Componente de subida:** reutilizable, con zona de arrastrar/soltar + botón visible + vista previa, aplicado en TODOS los puntos de subida de fotos existentes (tareas, galería general, ideas, propuestas). Además, página de catálogo interna (`/dev/components`).
- **Central de gastos:** una sola vista con 4 bloques — lo que debo (pendiente), lo que me deben (si soy acreedor), historial de pagos por mes/trimestre, totales agregados del fondo común (estos últimos con el mismo RBAC ya existente: Invitado ve solo agregados).

## Phases

| Phase | Name | Status |
|-------|------|--------|
| A | [Componente de subida reutilizable + catálogo](./phase-a-componente-subida-reutilizable.md) | Implemented |
| B | [Borrado/descarte de ideas y propuestas](./phase-b-borrado-ideas-propuestas.md) | Implemented |
| C | [Borrado de fotos individuales](./phase-c-borrado-fotos-individuales.md) | Implemented |
| D | [Central de gastos](./phase-d-central-de-gastos.md) | Implemented |

## Nota de implementación (post-hoc)

- **Uso de `UFileUpload` de Nuxt UI v4.9** en vez de construir un dropzone desde cero: ya venía con drag-and-drop, preview y accesibilidad — `app/components/media/PhotoUpload.vue` es un wrapper delgado que además encapsula la subida (FormData + POST) para que cada página necesite una sola línea.
- **Hallazgo de code review corregido:** la Fase A inicial dejó fuera el flujo de mayor uso real (comprobante de pago en `ledger/[id].vue`) porque el componente tenía el campo multipart fijo a `'file'` mientras ese endpoint espera `'proof'`. Se añadió una prop `fieldName` al componente y se migró ese flujo también. El PDF de cotización en `proposals/[id].vue` se dejó deliberadamente fuera (forma parte de un formulario multi-campo, no encaja con el modelo de subida autónoma del componente; ya tenía una etiqueta clara).
- **Validación cliente añadida** (prop `maxSizeMb`, chequeo de `accept`) tras hallazgo de review de que el componente inicial delegaba 100% en la validación del servidor pese a que el plan la pedía explícitamente.
- **Orden de borrado en `DELETE /api/media/[id]`** corregido tras review: se borra primero la fila de BD y después el objeto en MinIO (no al revés), para que un fallo parcial deje como mucho un objeto huérfano invisible en vez de una foto fantasma en la UI.
- **Sin tests automatizados nuevos** para `cancelProposal`, `media/[id].delete.ts` ni `dashboard-service.ts` — consistente con la cobertura ya escasa del proyecto; verificado funcionalmente con curl+psql para cada fase.

## Orden de ejecución

A → C (mismo componente, se aprovecha) → B → D. B y D son independientes entre sí, pero D reutiliza patrones de agregación ya existentes en `ledger`.

## Dependencias

- Reutiliza componentes/servicios de Fases 3 (deudas), 6 (governance), 7-8 (media, storage) ya en `develop`.
- No requiere nuevas dependencias externas ni variables de entorno nuevas.
