---
phase: 5
title: "Bot de Telegram y notificaciones"
status: pending
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
- **Estado de implementación:** Pendiente
- **Estado de revisión:** No revisado

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
- [ ] Bot creado + webhook con secret_token validado
- [ ] Webhook idempotente (dedupe update_id)
- [ ] Vinculación chat_id ↔ usuario por token
- [ ] Foto → vision-ocr → link de confirmación
- [ ] Schema notifications (outbox + prefs + links)
- [ ] enqueue dentro de TX del evento + dispatcher con reintento
- [ ] Email SMTP como canal independiente
- [ ] Preferencias de canal en perfil
- [ ] Nota de alcance: WhatsApp diferido

## Success Criteria
- [ ] Foto enviada al bot devuelve un link web que abre el gasto en revisión.
- [ ] Solo usuarios vinculados pueden crear gastos por el bot.
- [ ] Webhook rechaza peticiones sin secret válido y no duplica por reintentos de Telegram.
- [ ] Evento de deuda/voto/tarea genera notificación por los canales activados por el usuario.
- [ ] Desactivar un canal en perfil detiene sus notificaciones.

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
