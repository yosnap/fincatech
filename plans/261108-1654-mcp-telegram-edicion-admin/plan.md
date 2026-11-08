---
title: "Gestión admin desde Telegram (agente IA + MCP) y edición financiera en la web"
description: "Servidor MCP remoto dentro de la app con las acciones de finanzas, tareas, ideas y reservas; bot de Telegram con agente Claude que usa esas herramientas (solo admin); edición completa de aportes, fecha de gastos y detector de duplicados en la web."
status: in-progress
priority: P1
effort: 62h
branch: feat/v0.17.0
tags: [telegram, mcp, ia, claude, finanzas, aportes, gastos, admin]
blockedBy: []
blocks: []
created: 2026-11-08
source: conversación con usuario (2026-11-08)
---

# Gestión admin desde Telegram (agente IA + MCP) y edición financiera en la web

## Overview

El admin necesita corregir datos financieros (aportes duplicados, fechas mal puestas en aportes y gastos) y quiere hacerlo tanto desde la web como desde Telegram hablando en lenguaje natural. Se construye **una única capa de herramientas** sobre los servicios existentes (`server/services/*`), expuesta de dos formas: un **servidor MCP remoto** (`/mcp`, Streamable HTTP) usable desde Claude Desktop/claude.ai, y un **agente de Telegram** que llama a Claude API con esas mismas herramientas. En paralelo se completan las carencias de la web.

## Contrato acordado (2026-11-08)

| Decisión | Valor |
|---|---|
| Interfaz del bot | Agente IA (Claude API, tool use) + servidor MCP en la web |
| Alcance de acciones | Banco y aportes; gastos y deudas; liquidación y resúmenes; tareas, ideas, propuestas y reservas |
| Quién usa el bot / MCP | Solo cuentas con rol `admin` (bot: chat vinculado vía `/link`; MCP: **OAuth 2.1** con la sesión de Better Auth, para que funcione como conector remoto en claude.ai, Claude Desktop y Claude Code — decisión del usuario 2026-11-08) |
| Edición web | Fecha y notas de aportes; importe/tipo/período de aportes; fecha de gastos; detector de duplicados |
| Escrituras desde bot | Confirmación explícita (botones inline) antes de cualquier creación, edición o borrado |
| Deudas ajenas | El admin puede marcar como pagada la deuda de otro miembro (operación propia auditada «en nombre de»), en web, MCP y bot |
| Paridad de canales | Toda acción disponible en bot o MCP debe poder hacerse también desde la web como admin (la web nunca queda por detrás). La fase 4 incluye una matriz herramienta → pantalla web y cubre los huecos |
| Hipoteca | Cargo automático mensual configurable (importe por tramos desde un mes, día de cargo), retroactivo desde septiembre de 2026; los pagos manuales previos se muestran y el admin elige cuáles **adoptar** como cargo de su mes (conservan justificante) |
| Secretos | Token de Telegram y API key de Anthropic solo en variables de entorno (Easypanel / `.env`), nunca en el chat ni en el repo |

## Estado actual verificado

- Telegram ya tiene webhook (`server/routes/webhook/telegram.post.ts`): `/link TOKEN` y fotos de ticket → OCR → enlace de confirmación. Dedupe por `update_id`. Falta configurar env y `setWebhook`.
- `PATCH /api/bank/contributions/:id` ya acepta `date`/`notes` (admin) pero la UI no lo expone (solo eliminar y vincular).
- Movimientos bancarios: edición completa ya existe en web.
- **Gastos no tienen columna de fecha** (solo `createdAt`): editar fecha exige columna nueva + migración + backfill.
- Duplicados: solo las cuotas tienen índice único (miembro+mes). `extraordinary`/`pre_purchase` pueden duplicarse por doble envío o reintento.

## Decisiones de diseño

1. **Herramientas = servicios** (con la corrección del red-team: las reglas que hoy viven en endpoints se extraen primero a módulos compartidos). Cada herramienta es `{ name, description, inputSchema (zod), kind: 'read'|'write'|'destructive', handler(actor, input) }` y llama al servicio existente; nunca SQL directo. Reglas de negocio y `writeAuditLog` se heredan del servicio. Un único registro (`server/tools/registry.ts`) alimenta MCP y Telegram.
2. **Actor explícito.** Los servicios reciben `actorId`; las herramientas reciben un `SessionUser` resuelto por el canal (token MCP o chat vinculado) y verifican `role === 'admin'` antes de ejecutar.
3. **Auditoría del canal.** Metadata `channel: 'web'|'mcp'|'telegram'` en el audit log para saber desde dónde se hizo cada cambio.
4. **Confirmación en Telegram.** El agente no ejecuta `write`/`destructive` directamente: propone la acción, se guarda como `pending_action` (TTL 10 min) y se ejecuta solo al pulsar «Confirmar» (`callback_query`). En MCP la confirmación la hace el cliente (anotaciones `destructiveHint`).
5. **Autenticación MCP por OAuth.** El servidor MCP actúa como resource server; la app (Better Auth) es el authorization server: metadatos `/.well-known/oauth-protected-resource` y `/.well-known/oauth-authorization-server`, registro dinámico de clientes, PKCE, consentimiento tras el login normal, y solo se emiten tokens a usuarios `admin` no dados de baja. Primero se evalúa el plugin MCP/OIDC de Better Auth; si no cubre la especificación MCP vigente, se implementa el flujo mínimo propio. Desde el perfil del admin se ven y revocan los clientes y sesiones conectados.
6. **Edición completa de aporte** en una transacción: si cambia importe/tipo/período y el aporte está vinculado a un ingreso auto-creado por transferencia, se recalcula ese movimiento; si el movimiento agrupa varias cuotas (adelanto) o fue vinculado manualmente, se rechaza con mensaje claro (desvincular primero).
7. **Fecha de gasto**: columna `expense_date date not null`, backfill con `created_at::date`; la liquidación y los listados ordenan por ella.

## Non-goals

- Acceso al bot para propietarios o invitados (posible fase futura reutilizando el registro de herramientas).
- Gestión de miembros, roles, invitaciones o configuración financiera global desde bot/MCP.
- Bot en grupos de Telegram (solo chat privado).

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Explicar y prevenir los aportes duplicados | P1 |
| 2 | Editar aportes completos y fecha de gastos desde la web | P1 |
| 3 | Servidor MCP remoto con todas las acciones del alcance | P1 |
| 4 | Agente de Telegram operativo para el admin con confirmación | P1 |
| 5 | Telegram activado en producción con documentación | P1 |
| 6 | Cargo automático de la hipoteca sin entrada manual | P1 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Diagnóstico y detector de duplicados](./phase-01-start.md) | In progress (corrección RT-6 y diagnóstico en producción pendientes) |
| 2 | [Edición de aportes en la web](./phase-02-edicion-aportes-web.md) | Completed |
| 3 | [Fecha de gastos](./phase-03-fecha-gastos.md) | Pending |
| 4 | [Capa de herramientas y servidor MCP](./phase-04-capa-herramientas-y-mcp.md) | Pending |
| 5 | [Agente de Telegram](./phase-05-agente-telegram.md) | Pending |
| 6 | [Activación y despliegue](./phase-06-activacion-y-despliegue.md) | Pending |
| 7 | [Cargo automático de la hipoteca](./phase-07-cargo-automatico-hipoteca.md) | Pending |

Orden de ejecución: 1 → 2 → **7** → 3 → 4 → 5 → 6. Dependencias: 1→2 (el detector se reutiliza en el formulario); 2 y 3 antes de 4 (las herramientas exponen la edición nueva); 4→5→6.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| El agente IA ejecuta una acción equivocada | Confirmación obligatoria con resumen legible; borrados siempre `destructive`; audit log con canal |
| Fuga del token MCP o de Telegram | Tokens OAuth de vida corta con refresh y revocación desde el perfil; secretos solo en env; comparación en tiempo constante |
| Coste de Claude API | Modelo configurable por env, límite de turnos de herramienta por mensaje, rate limit por chat, registro de tokens consumidos |
| Recalcular movimiento rompe la conciliación | Reglas de la decisión 6 + tests de `bank-core` |
| Migración de `expense_date` | Backup de BD antes de migrar (regla del proyecto); backfill determinista |

## Success Criteria

- [ ] Causa de los duplicados documentada con evidencia (audit log / `created_at`) y un nuevo registro idéntico muestra aviso antes de guardarse.
- [ ] El admin cambia fecha, notas, importe, tipo y período de un aporte desde la web; el saldo bancario sigue cuadrando.
- [ ] El admin cambia la fecha de un gasto; listados, liquidación y exportación la reflejan.
- [ ] claude.ai y Claude Desktop conectados a `/mcp` por OAuth con cuenta admin listan aportes y editan una fecha; sin token → 401; un usuario no admin no obtiene token.
- [ ] Desde Telegram: «cambia la fecha del aporte X al 5 de octubre» → propuesta → Confirmar → cambio aplicado y auditado con `channel: telegram`. Un no-admin vinculado recibe rechazo.
- [ ] La hipoteca se carga sola cada mes desde septiembre de 2026 y los pagos manuales duplicados se pueden borrar eligiéndolos.
- [ ] `pnpm test`, `pnpm lint`, `pnpm typecheck` y `pnpm build` en verde.

## Validación previa

- Predict (5 personas): **CAUTION**, sin rediseño — `plans/reports/predict-261108-1815-mcp-telegram-hipoteca.md`.

## Red Team Review

### Session — 2026-11-08
**Findings:** 16 (15 aceptados, 1 rechazado) tras deduplicar 28 de 3 revisores
**Severity breakdown:** 1 Critical, 10 High, 5 Medium

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| 1 | Bot en grupos: autorización por chat y no por usuario | Critical | Accept | Fase 5 |
| 2 | `/link` como credencial de admin (no atómico, en claro) | High | Accept | Fase 5 |
| 3 | Reglas en endpoints, no en servicios | High | Accept | Fase 4 |
| 4 | Tareas/ideas sin servicio | Medium | Accept | Fase 4 |
| 5 | Canal de auditoría (AsyncLocalStorage, `system`) | High | Accept | Fases 4 y 7 |
| 6 | Carrera de duplicados y `force` expuesto | High | Accept | Fases 1 y 4 |
| 7 | Exfiltración por vistas previas / formato de mensajes | High | Accept | Fase 5 |
| 8 | Máquina de estados, cola por chat, memoria del resultado | High | Accept | Fase 5 |
| 9 | Pagos manuales de hipoteca: adoptar, no borrar | High | Accept (decisión: adoptar) | Fase 7 |
| 10 | Relleno no modifica existentes; marca de agua; límite de mes | High | Accept | Fase 7 |
| 11 | Migración `expense_date` (default, backfill Madrid) | High | Accept | Fase 3 |
| 12 | Liquidación/panel/export por `expenseDate` | High | Accept | Fase 3 |
| 13 | Fecha del OCR validada | Medium | Accept | Fase 3 |
| 14 | Admin marca deudas ajenas en nombre de otro | Medium | Accept (decisión: sí) | Fase 4 |
| 15 | Activar el webhook desde la web, no con script | High | Accept | Fase 6 |
| R1 | Tokens MCP sin caducidad | Medium | Reject (superado por OAuth) | — |

Informe completo: `plans/reports/red-team-261108-1820-mcp-telegram-hipoteca.md`.

<!-- slug: mcp-telegram-edicion-admin -->
