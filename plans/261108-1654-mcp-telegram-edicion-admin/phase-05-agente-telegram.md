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
El admin vinculado habla con el bot en lenguaje natural; el bot usa un modelo (API compatible con OpenAI) con las herramientas del registro y pide confirmación antes de cualquier cambio.

## Files to Create / Modify
- Modify: `server/routes/webhook/telegram.post.ts` (enrutar texto libre al agente y `callback_query` a confirmaciones; conservar `/link` y fotos)
- Create: `server/services/telegram-agent.ts` (bucle de tool use)
- Create: `server/services/telegram-confirmations.ts` (acciones pendientes)
- Modify: `server/services/telegram-bot.ts` (`sendMessage` con `reply_markup` inline, `answerCallbackQuery`, `editMessageText`, envío en Markdown seguro)
- Create: `server/db/schema/telegram-agent.ts` (`telegram_pending_actions`, `telegram_conversation_messages`) + migración
- Modify: `server/utils/env.ts`: `AI_AGENT_BASE_URL` (por defecto `https://api.nan.builders/v1`, el mismo proveedor del OCR; OpenRouter: `https://openrouter.ai/api/v1`), `AI_AGENT_API_KEY` (si falta, usa `NAN_BUILDERS_API_KEY`), `AI_AGENT_MODEL` (obligatorio para activar el agente). Todos opcionales: sin ellos el agente responde que no está configurado
- Create: `server/services/ai-chat-client.ts`: cliente `fetch` mínimo a `${AI_AGENT_BASE_URL}/chat/completions` con `tools` / `tool_choice: 'auto'` (mismo patrón que `vision-ocr.ts`, sin SDK nuevo); convierte los esquemas zod del registro a JSON Schema (`z.toJSONSchema` de zod 4); timeout y reintento único ante 429/5xx. OpenRouter: cabeceras opcionales `HTTP-Referer`/`X-Title`

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

## Red Team (2026-11-08)
- **[RT-1] Crítico:** rechazar cualquier update con `chat.type !== 'private'` (incluido `/link`, con mensaje). Guardar `telegram_user_id` (`from.id`) en `telegram_links` y exigir `from.id === telegram_user_id` en mensajes y en `callback_query.from.id`. Test: update desde grupo → rechazo; callback de otro usuario → rechazo.
- **[RT-2]** `/link`: token guardado hasheado; consumo atómico (`update … where id = ? and used_at is null and expires_at > now() returning`); si el admin ya tenía otro chat, avisar al chat anterior; mostrar en el perfil el `@username` vinculado con botón «Desvincular».
- **[RT-7]** Respuestas del agente en texto plano o HTML escapado, con `link_preview_options: { is_disabled: true }`; neutralizar URLs que no sean del dominio de la app; trocear en bloques de 4000 caracteres y reintentar en texto plano ante un 400; los campos libres de las salidas de herramientas se envuelven como datos y se truncan; el system prompt limita filas por respuesta.
- **[RT-8]** `telegram_pending_actions.status`: `pending → executing → done | failed`, con `result` / `error`; al arrancar, los `executing` huérfanos pasan a `failed` y se avisa al chat. Al confirmar se vuelve a comprobar `role = admin`, `!banned` y `!pendingApproval`, y que `callback_query.from.id` es el vinculado. El resultado (o la cancelación) se añade a la memoria del chat como mensaje sintético. Cola por chat (`Map<chatId, Promise>`, una réplica) y timeout global del bucle. Siempre se envía un mensaje de error al chat si algo falla.
- Las fotos de ticket siguen funcionando para propietarios vinculados en chat privado; solo el texto libre al agente exige admin.

## Proveedor de IA (decisión del usuario 2026-11-08)
- Sin dependencia de Anthropic: cualquier API **compatible con OpenAI** con *function calling* (OpenRouter, Nan Builders u otra), configurada con URL base + token + modelo.
- **Verificación previa obligatoria**: antes de construir el bucle, probar con el modelo elegido una llamada con 2-3 herramientas reales y comprobar que devuelve `tool_calls` válidos (JSON parseable, nombres existentes). Si el modelo de Nan Builders no soporta herramientas de forma fiable, documentar en `docs/deployment.md` un modelo de OpenRouter recomendado. Esto es un supuesto clave: sin *function calling* fiable el agente no cumple los criterios de éxito.
- Los argumentos de `tool_calls` se validan siempre con zod en `runTool` (el modelo puede devolver JSON inválido o campos de más): error legible devuelto al modelo, máximo 2 reintentos.
- El caché de prompt depende del proveedor: no se asume; el coste se controla con el límite de iteraciones, el rate limit y el registro de tokens (`usage`) por mensaje.

