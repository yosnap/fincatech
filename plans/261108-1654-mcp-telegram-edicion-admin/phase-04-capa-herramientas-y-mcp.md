---
phase: 4
title: "Phase 4: Capa de herramientas y servidor MCP"
status: todo
priority: P1
effort: 24h
dependencies: [2, 3]
---

# Phase 4: Capa de herramientas y servidor MCP

## Goal
Un registro único de herramientas sobre los servicios existentes, expuesto como servidor MCP remoto en `/mcp` con autenticación **OAuth 2.1** (solo admin), usable como conector en claude.ai, Claude Desktop y Claude Code.

## Files to Create / Modify
- Create: `server/tools/types.ts` (contrato `ToolDefinition`)
- Create: `server/tools/bank-tools.ts`, `expense-tools.ts`, `settlement-tools.ts`, `task-tools.ts`, `idea-tools.ts`, `proposal-tools.ts`, `reservation-tools.ts` (cada uno < 300 líneas)
- Create: `server/tools/registry.ts` (lista + `runTool(actor, name, input, channel)`)
- OAuth: plugin MCP/OIDC de Better Auth en `server/utils/auth.ts` si cumple la especificación MCP vigente (metadatos de recurso protegido, registro dinámico, PKCE); si no, flujo mínimo propio en `server/routes/oauth/*` + tablas de clientes y tokens (hash) con migración
- Create: `server/routes/.well-known/oauth-protected-resource.get.ts` (y metadatos del authorization server si no los da el plugin)
- Create: `app/pages/oauth/consent.vue` (pantalla de consentimiento tras el login; rechaza cuentas no admin)
- Create: `server/routes/mcp.ts` (Streamable HTTP, modo stateless) 
- Create: `server/api/admin/mcp-clients/index.get.ts`, `[id].delete.ts` (ver y revocar clientes/sesiones conectados)
- Modify: `app/pages/profile.vue` (sección «Aplicaciones conectadas (MCP)», solo admin; componente aparte)
- Modify: `server/utils/audit.ts` (metadata `channel`)
- Modify: `server/middleware/auth.ts` (excluir `/mcp` de la sesión por cookie; auth propia)
- Dependencia: `@modelcontextprotocol/sdk` (consultar docs actuales con context7 antes de implementar)

## Tasks & Steps
1. Contrato: `name` snake_case, `description` en español orientada al modelo, `inputSchema` zod, `kind: read|write|destructive`, `handler(actor, input)`. Salidas JSON compactas con importes en euros formateados además de céntimos.
2. Herramientas mínimas del alcance:
   - Banco/aportes: `listar_aportes` (filtros miembro/tipo/fechas), `crear_aporte`, `editar_aporte`, `eliminar_aporte`, `vincular_aporte`, `listar_duplicados_aportes`, `listar_movimientos`, `crear_movimiento`, `editar_movimiento`, `eliminar_movimiento`, `resumen_banco`, `cuotas_pendientes`.
   - Gastos/deudas: `listar_gastos`, `ver_gasto`, `cambiar_fecha_gasto`, `cambiar_participantes_gasto`, `eliminar_gasto`, `marcar_deuda_pagada`, `confirmar_cobro_deuda`.
   - Liquidación: `ver_liquidacion`, `estadisticas`.
   - Tareas/ideas/propuestas/reservas: listar, ver, crear, cambiar estado, eliminar (según servicios/API existentes; si la lógica vive en el endpoint y no en un servicio, extraerla primero a servicio sin cambiar comportamiento).
   - `listar_miembros` (solo lectura, para resolver nombres → ids).
3. `runTool`: valida input con zod, exige `actor.role === 'admin'` y no `banned`, pasa `channel` al audit, traduce `createError` a mensaje legible.
4. OAuth: verificar con documentación actual (context7: especificación de autorización MCP, Better Auth, conectores remotos de claude.ai) qué exige hoy el cliente. Access token de vida corta + refresh token; solo `admin` no `banned` puede consentir; el rol se comprueba también en cada petición a `/mcp` (un admin degradado pierde acceso al instante). Lista blanca de `redirect_uri` registradas; audiencia del token = URL de `/mcp`.
5. `/mcp`: Bearer OAuth válido → usuario admin activo; si no, 401 con `WWW-Authenticate` apuntando a los metadatos del recurso. Registrar herramientas del registro con anotaciones (`readOnlyHint`, `destructiveHint`). Rate limit con `utils/rate-limit.ts`.
6. **Matriz de paridad web**: tabla en `docs/system-architecture.md` con cada herramienta y la pantalla/botón web equivalente. Cualquier herramienta sin equivalente en la web (p. ej. vincular aporte desde otra vista, confirmar cobro, cambiar estado de propuesta) se añade a la UI en esta fase antes de darla por cerrada.
7. Tests: `registry` rechaza no-admin; validación de input; emisión de token denegada a no-admin; token de otra audiencia rechazado.

## Verification
- `pnpm test`, `pnpm typecheck`.
- `npx @modelcontextprotocol/inspector` contra `http://localhost:3017/mcp` completando el flujo OAuth: lista herramientas, `listar_aportes` responde, `editar_aporte` cambia fecha y aparece en audit con `channel: mcp`.
- Sin token / token revocado → 401.

## Red Team (2026-11-08)
- **[RT-3] Paso 0, antes de las herramientas:** extraer de los endpoints a módulos compartidos (`server/validation/*.ts` o al propio servicio) los esquemas zod y las reglas que hoy solo viven en el handler: elegibilidad de participantes (`api/expenses/index.post.ts:60-67`, `[id]/participants.patch.ts:26-30`), topes de importe, `isValidCalendarDate`, refine de categoría (`api/bank/transactions/*`), reglas de aportes (`api/bank/contributions/index.post.ts`). Endpoints y herramientas importan la misma definición. Test: la herramienta rechaza participantes invitados o dados de baja.
- **[RT-4]** Crear `server/services/task-service.ts` e `idea-service.ts` (y extraer la lógica de `proposals/[id].delete.ts`, `reservations/*`) moviendo el código de los handlers sin cambiar comportamiento (notificaciones, regla «solo se elimina una tarea descartada», máquina de estados de ideas). Bloque propio dentro de la fase.
- **[RT-5]** Canal de auditoría con `AsyncLocalStorage<{ channel }>`: `runTool` ejecuta dentro de `runWithChannel(channel, fn)`; `writeAuditLog` lo lee con valor por defecto `'web'`; valor `'system'` para el cron de la hipoteca. Test: un servicio llamado dentro de `runTool` audita con el canal correcto.
- **[RT-6]** `force` nunca forma parte del `inputSchema` de `crear_aporte`: el 409 de posible duplicado se devuelve al modelo como información.
- **[RT-14]** Nueva operación `adminSettleDebt` (decisión del usuario): el admin marca pagada la deuda de otro miembro; audit con `actorId` = admin y `metadata.onBehalfOf` = deudor; botón equivalente en la web (paridad). `marcar_deuda_pagada` usa esta operación cuando la deuda no es del admin. Nunca se pasa otro `actorId`.
- `listar_miembros` devuelve solo `id` y `name` (la salida llega a la API de Anthropic).
- Implementación por bloques con verificación en el inspector MCP al cerrar cada uno: banco + hipoteca → gastos/deudas → liquidación → tareas/ideas/propuestas/reservas.
