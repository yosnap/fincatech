# OCR + Bot Integrations — Reporte de Investigación
**Fecha:** 2026-07-12 | **Para:** Fase 2 (Automatización)

---

## 1. Extracción de Datos Estructurados (Tickets/Facturas)

### Recomendación: **OpenAI GPT-4o Vision con Structured Outputs**

**Por qué:**
- **Confiabilidad JSON a escala:** GPT-4o genera JSON válido consistente en flujos automatizados de alto volumen (vs Claude que es mejor en reasoning complejos pero menos predecible en JSON a escala).
- **Structured Outputs:** Fuerza un schema JSON estricto (fecha, proveedor, importe, impuestos, concepto) — sin alucinaciones de campos.
- **Costo:** ~$0.03 por imagen (GPT-4o) vs ~$0.03 Claude 3.5 Sonnet — equivalentes.
- **Simplicidad:** No requiere infraestructura OCR dedicada (vs Tesseract, PaddleOCR que necesitan pre/post-procesamiento).

**Implementación:**
```
Ticket (JPEG/PNG) → Encode Base64 → GPT-4o Vision API 
→ JSON Schema {date, vendor, amount, tax, concept} 
→ Validación local (zod/pydantic) → BD
```

**Alternativa descartada:** Tesseract/PaddleOCR requieren hosting + mantenimiento. Para pequeña comunidad, overkill.

---

## 2. Recepción de Imágenes vía Bot

### Recomendación: **Telegram Bot API (Fase 2a), WhatsApp después (Fase 2b)**

| Aspecto | Telegram | WhatsApp |
|--------|----------|----------|
| **Setup** | 5 min (BotFather) | 7-14 días (Business Verification) |
| **Coste** | Gratis | $0.025–$0.137/msg (julio 2026) |
| **Webhook** | Soporte nativo, <200ms | Sí, pero pacing limits |
| **Aprobación** | Ninguna | Requiere Business Verification |
| **Complejidad** | Mínima | Alta (templates, compliance) |

**Decisión:** Implementar **Telegram primero** en Fase 2a. Usuarios envían foto → webhook recibe → GPT-4o procesa → devuelve link web para confirmación.
**WhatsApp después** (Fase 2b) si demanda lo justifica. Coste acumulado: gratis Telegram + ~€2–5/mes WhatsApp (si se envían <200 msgs/mes de notificaciones).

**Webhook Pattern:**
```
BotFather token → Telegram API → tu /webhook → recibe foto
→ Descarga imagen → GPT-4o Vision → JSON → BD → envía link web de confirmación
```

---

## 3. Notificaciones Salientes (24h Window)

### Limitación WhatsApp vs Libertad Telegram

**WhatsApp:** Ventana 24h tras último mensaje entrante del usuario.
- **Dentro de 24h:** Puedes enviar cualquier mensaje ("free-form").
- **Fuera de 24h:** Solo templates pre-aprobados (Utility, Authentication, Marketing).

**Implicación:** Notificaciones de "Nueva deuda", "Votación abierta", "Tarea asignada" requieren templates si caen fuera de 24h.

**Telegram:** Sin límite. Envía notificaciones proactivas siempre.

### Recomendación para Notificaciones:
1. **Fase 2:** Usa Telegram para todo (sin restricciones).
2. **Si integras WhatsApp después:** Notificaciones urgentes vía templates pre-aprobados (ej. "Utility: Pago pendiente"). Notificaciones no-urgentes → solo si hay conversación activa.
3. **Email como fallback** (menciona sección 4.7 del PRD) para casos donde 24h ha expirado en WhatsApp.

---

## 4. Riesgos y Costes a Vigilar

| Riesgo | Mitigación |
|--------|-----------|
| **GPT-4o hallucinations** | Validar JSON schema localmente + manual review si confidence <95% |
| **Cambios de pricing OpenAI** | Monitorear rate cards (revisión trimestral) |
| **Telegram API changes** | Mínimo riesgo: API estable desde 2015 |
| **WhatsApp verification delays** | No bloquea Fase 2a (Telegram); tolerar 2 semanas si aplazas Fase 2b |
| **Pacing/Rate-limit Telegram** | <30 req/seg según docs; sin problema en comunidad pequeña |
| **Archivos corruptos** | Implementar retry + fallback manual en web UI |

---

## 5. Stack Recomendado para Fase 2

```
Frontend (Nuxt/Next)
  ├─ drag-drop web UI para facturas
  └─ webhook de confirmación (Telegram link)

Backend
  ├─ POST /webhook/telegram → descarga imagen
  ├─ POST /vision → llama GPT-4o con schema JSON
  ├─ POST /notifications → enruta a Telegram (libre)
  └─ DB: guardar tickets + metadata (OCR confidence, usuario, fecha)

Secrets (env):
  ├─ OPENAI_API_KEY
  └─ TELEGRAM_BOT_TOKEN
```

---

## Conclusión

**MVP Fase 2:** Telegram + GPT-4o Vision = setup 1 semana, coste ~$0 operativo (solo OpenAI).
**Escalado Fase 2b:** Añadir WhatsApp si usuarios lo demandan (~€2–5/mes).
**Email:** Activar desde Fase 1 como canal no-dependiente (Gmail SMTP).

Status: DONE
