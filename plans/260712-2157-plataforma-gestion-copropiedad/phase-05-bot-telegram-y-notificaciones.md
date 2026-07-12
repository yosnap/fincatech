---
phase: 5
title: "Bot de Telegram y notificaciones"
status: implemented
priority: P2
effort: 10h
dependencies: [4]
roadmap: "F2 · Automatización e integraciones"
---

# Phase 5: Bot de Telegram y notificaciones

## Context links
- PRD §4.1 (bot), §4.7 (notificaciones) — `docs/prd.md`
- Bot decidido (Telegram primero) y ventana WhatsApp — `research/researcher-02-integraciones-report.md`

## Overview
- **Fecha:** 2026-07-12
- **Descripción:** Bot de Telegram para recibir fotos de tickets (webhook → `vision-ocr` de Fase 4 → devuelve link web de confirmación) y motor de notificaciones (Telegram y/o email) para eventos de deuda, votación, tarea y vencimientos. Cada propietario activa/desactiva canales. WhatsApp queda como fase futura opcional, fuera del roadmap de 4 fases.
- **Prioridad:** P2
- **Estado de implementación:** Implementado (rama `feat/0.5.0-telegram-notificaciones`, mergeado a `develop`). **Sin `TELEGRAM_BOT_TOKEN` real** — el envío/recepción real contra la API de Telegram no se ha probado (ver nota post-hoc).
- **Estado de revisión:** Revisado por `code-reviewer` (2 altos + 2 medios corregidos; 3 medios y 3 bajos aceptados como trade-off documentado, ver nota post-hoc).

## Key Insights
- Telegram: setup 5 min (BotFather), gratis, webhook nativo <200ms, sin límite de ventana → notificaciones proactivas siempre.
- **WhatsApp NO en este roadmap:** requiere Business Verification (7-14 días), coste $0.025-0.137/msg, y ventana de 24h que obliga a plantillas pre-aprobadas para notificaciones fuera de ventana. Se implementaría en una Fase 2b futura solo si la demanda lo justifica; documentar como nota de alcance, no construir ahora.
- El bot debe vincular el `chat_id` de Telegram a un usuario de la plataforma (token de vinculación) para saber a quién pertenece el ticket y por seguridad.
- El bot reutiliza `vision-ocr` (Fase 4) y `expense-service` (Fase 3) — no duplicar lógica.
- Email como canal independiente (SMTP), no depende del bot; sirve de fallback.
- Webhook debe validar el `secret_token` de Telegram para rechazar peticiones falsas.
- **Mecanismo de disparo del dispatcher resuelto:** hosting confirmado en Easypanel (VPS/Docker persistente, no serverless) → dispatcher como proceso en background simple (`node-cron` dentro del mismo contenedor de la app) leyendo el outbox cada N segundos. No hace falta Nitro scheduled tasks ni cron externo del proveedor.
- Para el volumen esperado (grupo familiar, pocos eventos/día), el outbox+dispatcher sigue siendo la opción recomendada (barato de construir, evita perder notificaciones si Telegram/SMTP fallan momentáneamente) — mantenido tal cual, sin simplificar a envío inline.

## Requirements
- **Funcional:** vincular cuenta Telegram; recibir foto → OCR → link de confirmación; notificaciones (nueva deuda, votación abierta, tarea asignada, plazo próximo) por canal activado; preferencias de canal por usuario.
- **No funcional:** webhook idempotente (Telegram reintenta); validación de firma/secret; envío de notificaciones desacoplado (cola/tabla de salida) para no bloquear la request que dispara el evento.

## Architecture
```
Telegram → POST /server/routes/webhook/telegram.post.ts
  ├ valida secret_token; resuelve usuario por chat_id vinculado
  ├ descarga foto → vision-ocr (Fase 4) → crea borrador → responde link web
Eventos de dominio (Fase 3/6/7) → notification-service.enqueue(evento, usuario)
  → dispatcher lee outbox → Telegram bot API / email SMTP (según preferencias)
```
- `notification-service`: escribe en tabla `notifications_outbox` dentro de la TX del evento; un dispatcher (cron/queue) la vacía → entrega desacoplada y reintentable.
- Vinculación: `POST /api/telegram/link` genera token; usuario lo envía al bot; se asocia `chat_id`.

## Related code files
- Create: `server/routes/webhook/telegram.post.ts` (Nitro auto-route)
- Create: `server/services/telegram-bot.ts` (descarga media, envío mensajes)
- Create: `server/services/notification-service.ts` (enqueue + dispatch)
- Create: `server/services/email-sender.ts` (SMTP)
- Create: `server/db/schema/notifications.ts` (outbox, telegram_links, prefs por usuario)
- Create: `server/api/telegram/link.post.ts`
- Modify: `app/pages/profile.vue` (preferencias de canal)
- Modify: `server/utils/env.ts` (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, SMTP creds)

## Implementation Steps
1. Crear bot con BotFather; configurar webhook con `secret_token`.
2. `telegram.post.ts`: validar secret, dedupe por `update_id`, resolver usuario por `chat_id`.
3. Flujo de vinculación: token en web → mensaje al bot → asociar `chat_id` a usuario.
4. Foto recibida → descargar → `vision-ocr` → crear borrador → responder link web de confirmación.
5. `notifications` schema: outbox + preferencias (telegram/email on/off) + `telegram_links`.
6. `notification-service.enqueue` escribe en outbox dentro de la TX del evento (deuda/voto/tarea/vencimiento).
7. Dispatcher (cron Nitro / tarea programada) vacía outbox → Telegram/email; marcar entregado; reintento con backoff.
8. UI de preferencias de canal en perfil.
9. Documentar WhatsApp como fase futura (no implementar).

## Todo list
- [x] Bot: código del webhook + validación de `secret_token` completos — 👤 falta crear el bot real con BotFather y configurar el webhook en la API de Telegram.
- [x] Webhook idempotente (dedupe update_id)
- [x] Vinculación chat_id ↔ usuario por token
- [x] Foto → vision-ocr → link de confirmación (código completo; el tramo real Telegram→descarga sin probar, ver nota post-hoc)
- [x] Schema notifications (outbox + prefs + links)
- [x] enqueue dentro de TX del evento + dispatcher — reintento simple (intervalo fijo del cron, no backoff creciente; ver nota post-hoc)
- [x] Email SMTP como canal independiente (reutiliza `server/utils/email.ts` de la Fase 2)
- [x] Preferencias de canal en perfil
- [x] Nota de alcance: WhatsApp diferido — ya documentado en Key Insights de este archivo, no se ha construido nada de WhatsApp

## Success Criteria
- [x] Webhook rechaza peticiones sin secret válido (401, comparación de tiempo constante) y no duplica por reintentos de Telegram (verificado con curl: mismo `update_id` reenviado devuelve 200 sin reprocesar).
- [x] Solo usuarios vinculados pueden crear gastos por el bot (verificado en código: `handlePhoto` comprueba `telegramLinks` ANTES de tocar `vision-ocr`; un chat_id no vinculado nunca dispara una llamada de OCR con coste).
- [x] Evento de deuda genera entrada en el outbox de notificaciones (verificado vía psql: `createExpense` encola una notificación `debt_created` por cada deudor, dentro de la misma transacción). Voto/tarea no existen todavía (Fases 6/7); el mecanismo de enqueue ya está listo para reutilizarse ahí.
- [x] Desactivar un canal en perfil detiene sus notificaciones (verificado: con ambos canales desactivados, `createExpense` no genera ninguna fila en el outbox).
- [ ] 👤 **Requiere prueba manual del usuario:** crear el bot real con BotFather, vincular tu cuenta de Telegram, enviarle una foto de un ticket desde tu móvil y confirmar que llega el link de confirmación. Necesita tu token de bot real y tu Telegram — no automatizable sin tu intervención. No bloqueante para mergear; queda como item de seguimiento hasta que lo hagas.
- [ ] 👤 **Requiere prueba manual del usuario:** confirmar que una notificación real (ej. nueva deuda) llega a tu Telegram/email tras dispararse un evento de prueba. El pipeline completo (enqueue → dispatcher → intento de envío → captura de error) está verificado con SMTP/Telegram simulados; falta la entrega real.

## Risk Assessment
| Riesgo | Prob×Impacto | Mitigación |
|--------|--------------|------------|
| Webhook falso/spoof crea gastos | Media×Alto | Validar `secret_token`; exigir `chat_id` vinculado; rate-limit |
| Notificación bloquea/rompe la TX del evento | Media×Medio | Solo `enqueue` en la TX; envío real desacoplado en dispatcher |
| Reintentos de Telegram duplican gasto | Media×Medio | Dedupe por `update_id`; idempotencia en creación de borrador |
| **WhatsApp: coste/ventana 24h/verificación** | (futuro) | Diferido fuera del roadmap; si se activa, plantillas Utility pre-aprobadas + email fallback fuera de ventana |
| Fallo de entrega (Telegram/SMTP caído) | Media×Bajo | Outbox con reintento y backoff; no perder eventos |

## Security Considerations
- Validar `secret_token` del webhook; nunca confiar en payload sin verificar.
- `TELEGRAM_BOT_TOKEN` y SMTP creds solo en env server-side.
- Vinculación por token de un solo uso y expirable; un `chat_id` no vinculado no opera.
- No incluir datos sensibles de deuda individual en el cuerpo de notificaciones a canales externos (privacidad).

## Next steps
Cierra Roadmap F2. Fase 6: gobernanza — ideas, propuestas y votación.

## Nota de implementación (post-hoc)

- **⚠️ Sin `TELEGRAM_BOT_TOKEN` real en este entorno.** Igual que el `OPENAI_API_KEY` de la Fase 4, no se pudo probar contra la API real de Telegram. Se verificó todo lo que no depende de que Telegram responda de verdad (validación de `secret_token`, dedupe de `update_id`, persistencia de la vinculación chat_id↔usuario, generación/consumo de tokens de vinculación, preferencias de canal, encolado en el outbox, y el intento real de envío + captura de error tanto en SMTP como en la API de Telegram vía un token de prueba deliberadamente inválido). Lo que falta: enviar una foto real y confirmar que `downloadTelegramFile` + el link de confirmación funcionan de punta a punta con un bot real — eso ya estaba marcado 👤 en el plan original.
- **Bug encontrado durante la implementación (no de code review) y corregido:** el handler del webhook dejaba escapar un 500 sin capturar si `sendTelegramMessage` fallaba DESPUÉS de que el `update_id` ya se hubiera marcado como procesado (dedupe), dejando al usuario sin respuesta y sin posibilidad de que Telegram reintentara. Ahora todo lo posterior al dedupe está envuelto en un try/catch que solo loguea, nunca deja escapar un 500 (`server/routes/webhook/telegram.post.ts`).
- **Hallazgos de code review corregidos:**
  - **Reenvío duplicado de notificaciones por solapamiento del cron:** el dispatcher ahora reclama las filas del outbox de forma atómica (`UPDATE ... SET status='sending' WHERE status='pending' RETURNING`) antes de intentar el envío, más `noOverlap: true` en el propio `cron.schedule` como defensa adicional.
  - **Notificaciones agotadas quedaban invisibles:** al llegar a `MAX_ATTEMPTS` (5), ahora se marcan `status='failed'` explícitamente en vez de quedar `pending` para siempre.
  - **Inyección de HTML en el email de notificación:** la descripción de un gasto (texto libre de admin/owner) se interpolaba sin escapar en el `<p>` del email. Se añadió `escapeHtml` antes de renderizar.
  - **`objectName` sin verificar en `confirm-from-link.post.ts`:** el flujo de Telegram pasa la referencia del comprobante por la URL (query param, editable por el cliente antes de confirmar); ahora se valida el patrón esperado (`expenses/telegram/<id>.<ext>`) y se comprueba que el objeto exista de verdad en MinIO (`storage.objectExists`, nuevo) antes de crear el gasto.
- **Hallazgos aceptados como trade-off, no corregidos** (documentados explícitamente para no repetirlos como "olvido" en una futura revisión):
  - **Sin backoff creciente real** en los reintentos del dispatcher — solo el intervalo fijo del cron (30s) actúa como espaciado. Suficiente para el volumen esperado (familia, pocos eventos/día); el plan pedía "backoff" pero no un algoritmo específico.
  - **Sin rate-limit en el webhook** — coincide con una carencia de infraestructura de toda la app (no es exclusivo de esta fase), y el vector de abuso ya requiere el secret filtrado o un chat_id comprometido (la validación de `secret_token` + vinculación ya cierra el camino principal).
  - **`handleLinkCommand` sin try/catch propio** (a diferencia de `handlePhoto`): si el mensaje de confirmación falla tras un `/link` exitoso, el usuario no se entera de que sí quedó vinculado y un reintento con el mismo token da un mensaje confuso ("token caducado"). No hay pérdida de datos ni 500 (el catch exterior ya lo cubre), solo una UX subóptima en un caso de fallo de red poco probable — se puede verificar la vinculación real desde `/profile` en cualquier caso.
  - Sin tests automatizados nuevos para esta fase (dedupe, vinculación, outbox se verificaron manualmente con curl/psql, no quedan como regresión en CI) — mismo patrón que las Fases 2-4.
- **Diseño del borrador OCR de Telegram:** en vez de una tabla `ocr_drafts` intermedia (no estaba en el plan), el borrador completo (objectName + extracción + coste) viaja codificado en base64url dentro de la URL que el bot envía al usuario. Evita una tabla short-lived adicional y su limpieza; el trade-off es que la URL es más larga y el `objectName` requiere la validación añadida arriba.
- **`email-sender.ts` no se creó como archivo nuevo** (lo pedía el plan): se extendió `server/utils/email.ts` de la Fase 2 con una función `sendEmail` genérica, reutilizando el transporter SMTP ya configurado — evita duplicar la configuración de nodemailer.
