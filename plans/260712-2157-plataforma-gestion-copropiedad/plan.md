---
title: "Plataforma de Gestión de Copropiedad - Finca La Unión"
description: "Gestor web de gastos, pagos, ideas/propuestas, votación de derramas, tareas, fotos y notificaciones para copropietarios de una finca familiar."
status: pending
priority: P1
effort: 82h
branch: main
tags: [nuxt, postgresql, drizzle, ocr, telegram, copropiedad, fintech, minio, easypanel, better-auth]
blockedBy: []
blocks: []
created: 2026-07-12
createdBy: "ck:plan"
source: skill
---

# Plataforma de Gestión de Copropiedad - Finca La Unión

## Overview

Plataforma monolítica (Nuxt 3 + Nitro) sobre PostgreSQL + Drizzle para administrar la copropiedad de una finca familiar: contabilidad con división de deudas N-1, confirmación dual de pagos, captura de tickets por OCR y bot de Telegram, gobernanza (ideas → propuestas → votación → derramas → tareas), evidencia fotográfica y notificaciones. Stack, OCR y bot ya decididos (ver `research/`). Fuente funcional: `docs/prd.md`.

Las 8 fases del plan se agrupan en las 4 fases del roadmap del PRD (sección 6).

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Setup e infraestructura base](./phase-01-setup-e-infraestructura-base.md) | Pending |
| 2 | [Auth y RBAC 3 roles](./phase-02-auth-y-rbac-3-roles.md) | Pending |
| 3 | [Contabilidad gastos y división de deudas](./phase-03-contabilidad-gastos-y-divisi-n-de-deudas.md) | Pending |
| 4 | [OCR web GPT-4o Vision](./phase-04-ocr-web-gpt-4o-vision.md) | Pending |
| 5 | [Bot Telegram y notificaciones](./phase-05-bot-telegram-y-notificaciones.md) | Pending |
| 6 | [Ideas Propuestas y votación](./phase-06-ideas-propuestas-y-votaci-n.md) | Pending |
| 7 | [Derramas tareas y evidencia fotográfica](./phase-07-derramas-tareas-y-evidencia-fotogr-fica.md) | Pending |
| 8 | [Galería calendario y exportación](./phase-08-galer-a-calendario-y-exportaci-n.md) | Pending |

## Mapeo Roadmap PRD (§6) → Fases del plan

| Roadmap PRD | Fases del plan | Progreso |
|-------------|----------------|----------|
| F1 · MVP financiero | 1, 2, 3 | 0/3 |
| F2 · Automatización e integraciones | 4, 5 | 0/2 |
| F3 · Gobernanza y operaciones | 6, 7 | 0/2 |
| F4 · Extras operativos | 8 | 0/1 |

## Dependencies

Sin dependencias entre planes (proyecto greenfield, único plan activo). Cadena interna de bloqueo entre fases:

- 1 → 2 → 3 (F1 secuencial: infra antes de auth antes de contabilidad).
- 3 → 4 (OCR alimenta el registro de gastos), 3 → 5 (notificaciones dependen de eventos de deuda).
- 3 → 6 → 7 (derramas reutilizan el motor de deudas; tareas nacen de propuestas aprobadas).
- 3, 7 → 8 (exportación necesita contabilidad; galería reutiliza el repositorio de medios de la fase 7).

## Revisión Red-Team

Plan revisado con `ck:predict` (5 personas: Architect/Security/Performance/UX/Devil's Advocate) antes de la validación. Veredicto: **CAUTION**, sin bloqueantes. Detalle: `reports/red-team-plan-260712-2157-plataforma-gestion-copropiedad-report.md`.

## Validation Summary

**Validado:** 2026-07-12
**Preguntas realizadas:** 4

### Decisiones Confirmadas
- **Exportación fiscal (antes Pregunta Abierta #1):** PDF/CSV simple confirmado como suficiente, sin formato regulatorio certificado. Cerrado.
- **Límite de archivo (antes Pregunta Abierta #2):** 10MB tras compresión en cliente (JPEG/PNG/PDF), confirmado como definitivo. Almacenamiento: **MinIO** (self-hosted, S3-compatible) en vez de disco local — aplicado en Fases 1, 3, 4, 6, 7, 8. Cerrado.
- **Hosting:** **Easypanel** (PaaS self-hosted sobre Docker/VPS). Resuelve también el mecanismo de disparo del dispatcher de notificaciones de Fase 5 (proceso persistente, no serverless) — aplicado en Fases 1 y 5.
- **Auth (hallazgo red-team):** Lucia confirmado deprecado (marzo 2025, sin desarrollo activo). Se usa **Better Auth** directamente — aplicado en Fase 2.

### Action Items
- Ninguno pendiente — las 2 Preguntas Abiertas originales quedaron resueltas y las 4 respuestas ya están aplicadas en las fases correspondientes.
