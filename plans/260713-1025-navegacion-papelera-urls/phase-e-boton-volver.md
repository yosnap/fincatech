---
phase: E
title: "Botón volver en pantallas de detalle"
status: pending
priority: P1
effort: 0.5h
---

# Phase E: Botón volver

## Requirements
Enlace "← Volver" arriba de cada pantalla de detalle, apuntando al listado padre (ruta fija, no `router.back()`):
- `app/pages/tasks/[id].vue` → `/tasks`
- `app/pages/ideas/[id].vue` → `/ideas`
- `app/pages/proposals/[id].vue` → `/proposals`
- `app/pages/ledger/[id].vue` → `/ledger`

## Implementation
`<UButton icon="i-lucide-arrow-left" variant="ghost" to="/tasks" size="sm">Volver</UButton>` (o equivalente `NuxtLink`) antes de la tarjeta principal, mismo patrón en las 4 páginas.

## Tests / Validation
Verificación visual (el usuario la hará al confirmar el fix de subida de fotos).
