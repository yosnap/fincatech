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
- Create: `scripts/telegram-set-webhook.ts` (registra webhook con `secret_token`, `allowed_updates: [message, callback_query]`, y `setMyCommands`; lee el token del entorno, nunca lo imprime)
- Modify: `.env.example` (`ANTHROPIC_API_KEY`, `TELEGRAM_AGENT_MODEL`)
- Modify: `docs/deployment.md` (activación de Telegram y conexión MCP)
- Modify: `docs/system-architecture.md` (capa de herramientas, MCP, agente)
- Modify: `VERSION` → 0.17.0

## Tasks & Steps
1. El usuario crea el bot con @BotFather y pone `TELEGRAM_BOT_TOKEN` en Easypanel; se genera `TELEGRAM_WEBHOOK_SECRET` aleatorio y `ANTHROPIC_API_KEY`. Nada de esto pasa por el chat.
2. Ejecutar el script contra `https://<dominio>/webhook/telegram`; comprobar con `getWebhookInfo` (sin errores pendientes).
3. Admin genera token MCP en el perfil y conecta Claude Desktop/claude.ai (conector remoto con cabecera Bearer) — documentar la configuración.
4. Verificación local completa (test, lint, typecheck, build), code review del diff, merge `feat/v0.17.0` → `develop`; a `main` solo con petición explícita.
5. Prueba de humo en producción: `/link`, pregunta de solo lectura, una edición confirmada, foto de ticket.

## Verification
- `getWebhookInfo` sin `last_error_message`.
- Prueba de humo completa registrada en `plans/reports/`.
