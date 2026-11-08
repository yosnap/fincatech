---
phase: 5
title: "Phase 5: Agente de Telegram"
status: todo
priority: P1
effort: 9h
dependencies: [4]
---

# Phase 5: Agente de Telegram

## Goal
El admin vinculado habla con el bot en lenguaje natural; el bot usa Claude con las herramientas del registro y pide confirmación antes de cualquier cambio.

## Files to Create / Modify
- Modify: `server/routes/webhook/telegram.post.ts` (enrutar texto libre al agente y `callback_query` a confirmaciones; conservar `/link` y fotos)
- Create: `server/services/telegram-agent.ts` (bucle de tool use)
- Create: `server/services/telegram-confirmations.ts` (acciones pendientes)
- Modify: `server/services/telegram-bot.ts` (`sendMessage` con `reply_markup` inline, `answerCallbackQuery`, `editMessageText`, envío en Markdown seguro)
- Create: `server/db/schema/telegram-agent.ts` (`telegram_pending_actions`, `telegram_conversation_messages`) + migración
- Modify: `server/utils/env.ts` (`ANTHROPIC_API_KEY`, `TELEGRAM_AGENT_MODEL` con valor por defecto, opcionales)
- Dependencia: `@anthropic-ai/sdk` (consultar skill `claude-api` para ids de modelo y formato de tools)

## Tasks & Steps
1. Autorización: chat → `telegram_links` → usuario; solo `admin` no `banned`. Resto: mensaje «Este bot solo está disponible para administradores».
2. Agente: system prompt en español (contexto FincaTech, fecha de hoy Europe/Madrid, importes en euros, pedir aclaración si hay ambigüedad entre varios aportes). Herramientas convertidas desde zod a JSON Schema. Máx. 8 iteraciones de herramienta por mensaje.
3. Herramientas `read` se ejecutan directamente. `write`/`destructive`: no se ejecutan; se crea `telegram_pending_actions(id, chat_id, user_id, tool, input, summary, expires_at, status)` y se devuelve al modelo «pendiente de confirmación»; el bot envía el resumen con botones «Confirmar» / «Cancelar» (`callback_data` = id).
4. `callback_query`: verifica que el chat y el usuario coinciden, que no ha caducado (10 min) y que sigue `pending`; ejecuta `runTool(..., 'telegram')` una sola vez (update atómico de estado) y edita el mensaje con el resultado.
5. Memoria corta: últimos 20 mensajes por chat (texto, sin datos sensibles extra), con comando `/nuevo` para reiniciar.
6. Límites: rate limit por chat, registro de tokens de entrada/salida por mensaje en logs; si falta `ANTHROPIC_API_KEY`, responder que el asistente no está configurado (las fotos siguen funcionando).
7. Telegram exige respuesta rápida al webhook: procesar el agente sin bloquear la respuesta 200 (lanzar la tarea y responder; el dedupe actual evita reprocesar), mostrando «escribiendo…» (`sendChatAction`).
8. Tests: confirmación caducada, doble pulsación (solo una ejecución), usuario no admin, chat distinto.

## Verification
- `pnpm test`.
- Manual con bot de pruebas: «¿cuánto hay en el banco?», «muéstrame aportes duplicados», «cambia la fecha del aporte de X al 5/10» → Confirmar → cambio aplicado y visible en la web; «Cancelar» no cambia nada.
