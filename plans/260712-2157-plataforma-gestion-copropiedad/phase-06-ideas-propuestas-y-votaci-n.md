---
phase: 6
title: "Ideas, Propuestas y votación"
status: pending
priority: P2
effort: 12h
dependencies: [3]
roadmap: "F3 · Gobernanza y operaciones"
---

# Phase 6: Ideas, Propuestas y votación

## Context links
- PRD §4.3 (propuestas/votación), §4.5 (ideas) — `docs/prd.md`
- Ideas ≠ Propuestas (decisión cerrada) — `plans/reports/analisis-huecos-260712-1628-prd-gestion-copropiedad-report.md`

## Overview
- **Fecha:** 2026-07-12
- **Descripción:** Dos módulos distintos: **Ideas** (bandeja libre, sin presupuesto ni voto, con comentarios y promoción a propuesta) y **Propuestas** (cotización múltiple A/B/C + votación democrática por opciones + cierre). El cierre ganador prepara la generación de derrama+tarea de la Fase 7. No implementa aún la derrama.
- **Prioridad:** P2
- **Estado de implementación:** Pendiente
- **Estado de revisión:** No revisado

## Key Insights
- Ideas y Propuestas son módulos separados (decisión cerrada): Idea = informal `Nueva→En Discusión→Promovida|Descartada`; Propuesta = formal con cotización y voto.
- Promoción: Admin o autor promueve idea madura → crea Propuesta que hereda título/descripción y queda enlazada a la idea de origen.
- Votación: una opción-presupuesto gana por mayoría O por decisión del Admin. Definir regla de mayoría (simple sobre votos emitidos) y desempate (Admin decide).
- **Integridad del voto:** un propietario = un voto por propuesta; Invitado no vota; voto auditado. Cierre idempotente (no recontar dos veces).
- El cierre marca la propuesta `Aprobada` con la opción ganadora, dejando el "gancho" que la Fase 7 consume para generar derrama+tarea. Separar cierre (aquí) de ejecución (Fase 7) evita acoplar votación con contabilidad.
- Guest: solo lectura; no comenta, no vota (RBAC Fase 2).

## Requirements
- **Funcional:** CRUD ideas + comentarios + cambios de estado; promover idea→propuesta; crear propuesta; adjuntar cotizaciones (opciones con precio/condiciones/PDF); votar por opción; cerrar votación (mayoría o Admin) → `Aprobada` con ganadora.
- **No funcional:** un voto por usuario/propuesta (constraint único); cierre idempotente; auditoría de votos y cierres.

## Architecture
```
Idea (estado) ──promote──> Proposal (hereda título/desc, link origen)
Proposal → Quote[] (A/B/C: precio, condiciones, pdf)
Voter → Vote (owner, proposal, quote_option)  [UNIQUE(owner, proposal)]
closeProposal(actor) ── TX
  ├ cuenta votos por opción; determina ganadora (mayoría | Admin override)
  ├ estado→'Aprobada'; fija winning_quote_id
  ├ audit_log
  └ COMMIT  → deja gancho para Fase 7 (sin generar derrama aquí)
```

## Related code files
- Create: `server/db/schema/governance.ts` (ideas, idea_comments, proposals, quotes, votes)
- Create: `server/services/proposal-service.ts` (promote, close, tally)
- Create: `server/api/ideas/*`, `server/api/proposals/*`, `server/api/proposals/[id]/vote.post.ts`
- Create: `app/pages/ideas/*`, `app/pages/proposals/*`
- Create: `app/components/governance/*` (form idea, cotizaciones, panel de votación)
- Modify: `server/utils/rbac.ts` (guest no vota/comenta)

## Implementation Steps
1. Schema: `ideas` (+estado, autor), `idea_comments`, `proposals` (+estado, idea_origen, winning_quote_id), `quotes`, `votes` con `UNIQUE(owner_id, proposal_id)`.
2. CRUD ideas + comentarios + transiciones de estado (autorización por rol).
3. `promote`: idea→propuesta heredando título/desc, enlazando origen; marca idea `Promovida`.
4. Cotizaciones: adjuntar opciones (precio en céntimos, condiciones, PDF/enlace).
5. Votación: `vote` respeta constraint único; Invitado 403; auditar.
6. `close`: TX, tally por opción, mayoría o `Admin override`, fija ganadora y estado `Aprobada`, idempotente.
7. UI: bandeja de ideas, detalle con comentarios, propuesta con cotizaciones y panel de votación/resultado.

## Todo list
- [ ] Schema ideas/comments/proposals/quotes/votes (+UNIQUE voto)
- [ ] CRUD ideas + comentarios + estados
- [ ] Promoción idea→propuesta enlazada
- [ ] Cotizaciones múltiples (precio/condiciones/PDF)
- [ ] Votación con un voto por usuario + guest bloqueado
- [ ] Cierre idempotente (mayoría / Admin override) → Aprobada + ganadora
- [ ] UI ideas y propuestas
- [ ] Auditoría de votos y cierre

## Success Criteria
- [ ] Un propietario no puede emitir dos votos en la misma propuesta (constraint verificado).
- [ ] Invitado no puede votar ni comentar (403).
- [ ] Promover una idea crea una propuesta enlazada que hereda título/descripción.
- [ ] Cerrar una propuesta dos veces no cambia el resultado (idempotente).
- [ ] Propuesta cerrada queda `Aprobada` con `winning_quote_id` fijado, lista para Fase 7.

## Risk Assessment
| Riesgo | Prob×Impacto | Mitigación |
|--------|--------------|------------|
| Doble voto / manipulación de conteo | Media×Alto | `UNIQUE(owner,proposal)` + tally en TX + auditoría |
| Cierre acoplado a contabilidad (regresión cruzada) | Media×Medio | Separar cierre (F6) de generación de derrama (F7) por un gancho de estado |
| Ambigüedad en regla de mayoría/desempate | Media×Medio | Regla explícita (mayoría simple) + Admin override documentado |
| Confusión Ideas vs Propuestas en UI | Baja×Medio | Módulos y navegación separados; promoción explícita |

## Security Considerations
- RBAC estricto: guest sin voto/comentario; solo Admin o autor promueve/cierra según regla.
- Auditar cada voto y cierre (actor+timestamp).
- Validar PDFs/enlaces de cotización (máx 10MB, PDF) y subir a MinIO (bucket privado, Fase 1).

## Next steps
Fase 7: consumir el gancho de propuesta aprobada para generar derrama automática + tarea de ejecución con evidencia fotográfica.
