---
phase: 4
title: "Phase 4: Capa de herramientas y servidor MCP"
status: todo
priority: P1
effort: 10h
dependencies: [2, 3]
---

# Phase 4: Capa de herramientas y servidor MCP

## Goal
Un registro único de herramientas sobre los servicios existentes, expuesto como servidor MCP remoto en `/mcp` con autenticación por token de admin.

## Files to Create / Modify
- Create: `server/tools/types.ts` (contrato `ToolDefinition`)
- Create: `server/tools/bank-tools.ts`, `expense-tools.ts`, `settlement-tools.ts`, `task-tools.ts`, `idea-tools.ts`, `proposal-tools.ts`, `reservation-tools.ts` (cada uno < 300 líneas)
- Create: `server/tools/registry.ts` (lista + `runTool(actor, name, input, channel)`)
- Create: `server/db/schema/api-tokens.ts` + migración
- Create: `server/utils/api-token.ts` (generar, hashear, verificar en tiempo constante)
- Create: `server/routes/mcp.ts` (Streamable HTTP, modo stateless) 
- Create: `server/api/admin/api-tokens/index.get.ts`, `index.post.ts`, `[id].delete.ts`
- Modify: `app/pages/profile.vue` (sección «Acceso MCP», solo admin; nuevo componente si supera tamaño)
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
4. Tokens API: `api_tokens(id, user_id, name, token_hash, last_used_at, revoked_at, created_at)`. Valor `ft_` + 32 bytes aleatorios, mostrado una sola vez.
5. `/mcp`: Bearer → usuario admin activo; si no, 401. Registrar herramientas del registro con anotaciones (`readOnlyHint`, `destructiveHint`). Rate limit con `utils/rate-limit.ts`.
6. **Matriz de paridad web**: tabla en `docs/system-architecture.md` con cada herramienta y la pantalla/botón web equivalente. Cualquier herramienta sin equivalente en la web (p. ej. vincular aporte desde otra vista, confirmar cobro, cambiar estado de propuesta) se añade a la UI en esta fase antes de darla por cerrada.
7. Tests: `registry` rechaza no-admin; validación de input; hash/verificación de token.

## Verification
- `pnpm test`, `pnpm typecheck`.
- `npx @modelcontextprotocol/inspector` contra `http://localhost:<puerto>/mcp` con token: lista herramientas, `listar_aportes` responde, `editar_aporte` cambia fecha y aparece en audit con `channel: mcp`.
- Sin token / token revocado → 401.
