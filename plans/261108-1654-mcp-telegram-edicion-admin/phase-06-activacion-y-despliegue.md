---
phase: 6
title: "Phase 6: Activación y despliegue"
status: todo
priority: P1
effort: 4h
dependencies: [5]
---

# Phase 6: Activación y despliegue

## Goal
Bot y MCP funcionando en producción, con pasos de activación documentados y repetibles.

## Files to Create / Modify
- **[RT-15]** Create: `server/api/admin/telegram/webhook.post.ts` y `webhook.get.ts` (solo admin): registran el webhook desde dentro del contenedor con `secret_token`, `allowed_updates: [message, callback_query]` y `setMyCommands`, y devuelven `getWebhookInfo` sin el token
- Create: botón «Activar Telegram» y estado del webhook en la configuración de la web (admin)
- Modify: `docker-compose.yml` / variables de Easypanel: `TZ=Europe/Madrid`
- Modify: `.env.example` (`AI_AGENT_BASE_URL`, `AI_AGENT_API_KEY`, `AI_AGENT_MODEL`)
- Modify: `docs/deployment.md` (activación de Telegram y conexión MCP)
- Modify: `docs/system-architecture.md` (capa de herramientas, MCP, agente)
- Modify: `VERSION` → 0.17.0

## Tasks & Steps
1. El usuario crea el bot con @BotFather y pone `TELEGRAM_BOT_TOKEN` en Easypanel; se genera `TELEGRAM_WEBHOOK_SECRET` aleatorio y las variables del proveedor de IA (`AI_AGENT_BASE_URL`, `AI_AGENT_API_KEY`, `AI_AGENT_MODEL`). Nada de esto pasa por el chat.
2. Pulsar «Activar Telegram» en la web (admin); la pantalla muestra `getWebhookInfo` sin errores pendientes. En BotFather, desactivar la entrada en grupos (`/setjoingroups`).
3. Conectar claude.ai y Claude Desktop como conector remoto `https://<dominio>/mcp` completando el flujo OAuth con la cuenta admin; documentar la configuración y cómo revocar desde el perfil.
4. Verificación local completa (test, lint, typecheck, build), code review del diff, merge `feat/v0.17.0` → `develop`; a `main` solo con petición explícita.
5. Prueba de humo en producción: `/link`, pregunta de solo lectura, una edición confirmada, foto de ticket.

## Verification
- `getWebhookInfo` sin `last_error_message`.
- Prueba de humo completa registrada en `plans/reports/`.
