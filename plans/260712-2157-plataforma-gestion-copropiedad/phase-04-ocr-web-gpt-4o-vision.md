---
phase: 4
title: "OCR web con GPT-4o Vision"
status: implemented
priority: P2
effort: 8h
dependencies: [3]
roadmap: "F2 · Automatización e integraciones"
---

# Phase 4: OCR web con GPT-4o Vision

## Context links
- PRD §4.1 (captura omnicanal, OCR) — `docs/prd.md`
- OCR decidido (GPT-4o Vision + Structured Outputs) — `research/researcher-02-integraciones-report.md`

## Overview
- **Fecha:** 2026-07-12
- **Descripción:** Subida web drag-and-drop de tickets/facturas (JPEG/PNG/PDF) y extracción estructurada vía GPT-4o Vision (Structured Outputs): fecha, proveedor, importe, impuestos, concepto. El usuario revisa/corrige antes de confirmar y crear el gasto (reutiliza `expense-service` de Fase 3). Sin infraestructura OCR dedicada.
- **Prioridad:** P2
- **Estado de implementación:** Implementado (rama `feat/0.4.0-ocr-web`, mergeado a `develop`). Proveedor cambiado de OpenAI GPT-4o a `gemma4` (nan.builders) el 2026-07-13 — **verificado contra la API real** con imagen de ticket sintética (ver addendum en nota post-hoc). Pendiente: prueba con fotos reales de tickets (👤).
- **Estado de revisión:** Revisado por `code-reviewer` (1 alto + 2 bajos, corregidos). El payload de OpenAI (`vision-ocr.ts`) se validó por inspección de código contra la documentación de Structured Outputs, no contra la API real — riesgo no verificado documentado abajo.

## Key Insights
- **Coste ~$0.03/imagen (GPT-4o).** No es gratis: cada subida gasta dinero real. Mitigar con validación previa (tipo/tamaño), evitar reintentos automáticos ciegos y registrar coste/confidence por llamada.
- Structured Outputs fuerza schema JSON estricto → sin campos alucinados, pero los VALORES pueden ser erróneos: **human-in-the-loop obligatorio**, el usuario confirma antes de crear el gasto.
- OCR nunca crea el gasto directamente: produce un borrador editable que pasa por el flujo validado de Fase 3.
- PDFs multipágina y fotos borrosas: definir fallback a entrada manual (Fase 3) si la extracción falla o confidence < umbral.
- Reutilizable por el bot (Fase 5): encapsular la llamada Vision en un servicio único.

## Requirements
- **Funcional:** drag-and-drop de imagen/PDF; llamada a Vision con schema; pantalla de revisión con campos precargados y editables; confirmar → crea gasto (Fase 3); marcar "Sin Comprobante" no aplica (aquí siempre hay archivo).
- **No funcional:** validar tipo/tamaño antes de llamar a la API (ahorro de coste); timeout + manejo de error con fallback manual; registrar confidence y coste; secreto `OPENAI_API_KEY` solo en env.

## Architecture
```
Web drag-drop → POST /api/ocr/extract
  ├ valida MIME/tamaño (rechaza antes de gastar API)
  ├ encode base64 → GPT-4o Vision (JSON schema: date,vendor,amount,tax,concept)
  ├ valida salida con zod + confidence
  └ devuelve borrador → UI de revisión → confirmar → expense-service.createExpense (Fase 3)
```
- `server/services/vision-ocr.ts`: única puerta a la API Vision (usada también por Fase 5).
- Guardar imagen (comprimida) en MinIO vía `storage.ts` (Fase 1) como `payment_proof` vinculado al gasto creado.

## Related code files
- Create: `server/services/vision-ocr.ts` (llamada Vision + validación zod del schema)
- Create: `server/api/ocr/extract.post.ts`
- Create: `app/components/expense/ocr-dropzone.vue`, `app/components/expense/ocr-review.vue`
- Create: `app/pages/expenses/new-from-ticket.vue`
- Modify: `server/utils/env.ts` (añadir `OPENAI_API_KEY`)
- Modify: `server/db/schema/expenses.ts` (columnas `ocr_confidence`, `ocr_cost`)

## Implementation Steps
1. Definir schema JSON (zod) de extracción: fecha, proveedor, importe (céntimos), impuestos, concepto.
2. `vision-ocr.ts`: encode base64, llamada GPT-4o con Structured Outputs, validar salida con zod, devolver confidence.
3. Endpoint `POST /api/ocr/extract`: comprimir imagen en cliente antes de subir; validar MIME/tamaño real (10MB, JPEG/PNG/PDF) ANTES de llamar a la API (ahorro de coste); subir original comprimido a MinIO (Fase 1) tras confirmar.
4. UI dropzone + pantalla de revisión con campos editables precargados.
5. Confirmar → `createExpense` (Fase 3) + guardar imagen como comprobante + registrar confidence/coste.
6. Fallback: si falla la API o confidence < umbral, ofrecer entrada manual con datos parciales.
7. Manejo de PDF: extraer primera página o rechazar multipágina con mensaje claro (según alcance MVP).

## Todo list
- [x] Schema zod de extracción estructurada (`ocrExtractionSchema` en `vision-ocr.ts`)
- [x] `vision-ocr` service con Structured Outputs + validación — verificado contra la API real de `gemma4`/nan.builders (ver addendum)
- [x] Endpoint extract con validación de archivo previa (control de coste)
- [x] UI drag-drop + pantalla de revisión editable (una sola página con dos pasos, no 3 componentes separados — decisión YAGNI, ver nota)
- [x] Integración con createExpense (Fase 3) + guardar comprobante (comprobante subido a MinIO ANTES de crear el gasto, misma transacción — hallazgo de code review corregido)
- [x] Registro de confidence y coste por llamada (columnas `ocr_confidence`/`ocr_cost_usd`)
- [x] Fallback a manual si falla/low-confidence (503 claro + enlace directo a `/ledger` para registro manual; el umbral de confidence bajo se muestra al usuario en la pantalla de revisión pero no bloquea confirmar — el humano decide)

## Success Criteria
- [x] Ticket legible se extrae en JSON válido y precarga la pantalla de revisión — verificado con imagen sintética contra `gemma4`/nan.builders: los 6 campos (fecha, proveedor, importe, IVA, concepto, confianza) se extrajeron correctamente. Pendiente 👤 con fotos reales (ver Todo de seguimiento abajo).
- [x] Ningún gasto se crea sin confirmación humana (verificado en código: `extract.post.ts` nunca llama a `createExpense`; solo `confirm.post.ts` lo hace, y solo tras la pantalla de revisión).
- [x] Archivos de tipo/tamaño inválido se rechazan antes de llamar a la API (verificado: el PDF y la firma falsa se rechazan sin alcanzar `extractReceiptData`; aunque con `OPENAI_API_KEY` ausente el 503 de "no configurado" enmascara el resultado exacto en este entorno, el orden del código sí valida primero).
- [x] Fallo de la API degrada a entrada manual sin bloquear al usuario (verificado con curl: 503 claro + la UI ofrece ir a `/ledger`).
- [x] Se registra confidence y coste por extracción (verificado con curl vía `/api/ocr/confirm`: `ocrConfidence`/`ocrCostUsd` persisten correctamente).
- [ ] 👤 **Requiere prueba manual del usuario:** subir 3-5 fotos de tickets REALES (no sintéticos) tomadas con el móvil y validar que la extracción de `gemma4` es suficientemente precisa para el uso diario. No bloqueante para mergear la fase — se deja como item de seguimiento si la calidad no convence. Precondición ya cumplida: `NAN_BUILDERS_API_KEY` configurada en `.env` y verificada funcionando.

## Risk Assessment
| Riesgo | Prob×Impacto | Mitigación |
|--------|--------------|------------|
| **Coste OCR ~$0.03/img se dispara** | Media×Medio | Validar archivo antes de llamar; sin reintentos ciegos; registrar coste; revisar rate card OpenAI trimestralmente |
| Valores extraídos erróneos (alucinación de valor) | Alta×Alto | Human-in-the-loop obligatorio; nunca crear gasto sin confirmar |
| Cambio de pricing/API OpenAI | Media×Medio | Aislar en `vision-ocr.ts`; monitorizar rate cards |
| Archivo corrupto/borroso | Media×Bajo | Retry manual + fallback a entrada manual |
| Fuga de `OPENAI_API_KEY` | Baja×Alto | Solo en env server-side; nunca al cliente |

## Security Considerations
- `OPENAI_API_KEY` solo server-side; la llamada Vision nunca desde el navegador.
- Validar/sanear archivo subido (MIME real, tamaño) antes de procesar.
- No enviar a la API datos más allá de la imagen del ticket; sin PII innecesaria.
- Imagen almacenada en MinIO (bucket privado, URL firmada) como comprobante, igual que Fase 3.

## Next steps
Fase 5: recibir tickets por bot de Telegram y añadir notificaciones, reutilizando `vision-ocr`.

## Nota de implementación (post-hoc)

- **⚠️ Sin verificar contra la API real de OpenAI** *(histórico — superado, ver addendum abajo)*. No había `OPENAI_API_KEY` disponible en este entorno de desarrollo (el usuario no estaba disponible para proporcionarla durante la sesión de implementación). `server/services/vision-ocr.ts` está escrito siguiendo la documentación de Structured Outputs de OpenAI (payload `response_format: json_schema` en modo `strict`, `image_url` con data URI base64) y revisado por `code-reviewer` por inspección de código, pero **la llamada real nunca se ha ejecutado ni una sola vez**. Si el shape del payload/response no coincide exactamente con lo esperado, el fallo más probable es en el parseo de `response.choices[0].message.content` o en el campo `refusal` (OpenAI puede devolver `message.refusal` en vez de `message.content` si rechaza la imagen por política de contenido — hoy ese caso cae en el fallback genérico "respuesta de OCR vacía", no crashea, pero no da un mensaje específico).
- **PDF explícitamente fuera de alcance para OCR** (decisión de esta fase, no del plan original): la API de chat completions de Vision no acepta PDF directamente sin rasterizar la primera página a imagen, lo que requeriría una librería nueva (p.ej. `pdf-lib` + un rasterizador) que no se pudo verificar sin credenciales reales tampoco. Un ticket en PDF se registra manualmente (Fase 3), no vía OCR. El plan mencionaba "extraer primera página o rechazar multipágina... según alcance MVP" — se optó por rechazar todo PDF, no solo multipágina.
- **`OPENAI_API_KEY` opcional en `server/utils/env.ts`** (a propósito, a diferencia de todas las demás variables que son fail-fast obligatorias): sin ella, `isOcrConfigured()` degrada el endpoint a 503 claro en vez de impedir que arranque toda la aplicación. Esto es lo que permitió implementar y verificar el resto del pipeline (validación de archivo, RBAC, integración con `createExpense`, persistencia de comprobante) sin bloquear toda la sesión de trabajo a la espera de credenciales.
- **UI fusionada a una sola página** (`app/pages/expenses/new-from-ticket.vue`) en vez de los 3 archivos que listaba el plan (`ocr-dropzone.vue`, `ocr-review.vue`, `new-from-ticket.vue`): es un flujo lineal de una sola pantalla con dos estados (subir → revisar), no tres componentes reutilizables independientes en otras partes de la app — separarlos habría sido indirection sin beneficio real (YAGNI).
- **Orden subida-antes-que-transacción** (hallazgo de code review, corregido): `server/api/ocr/confirm.post.ts` sube el comprobante a MinIO ANTES de llamar a `createExpense`, y el registro en `payment_proofs` se inserta DENTRO de la misma transacción que crea el expense+debts (`expense-service.ts` ahora acepta un `proof` opcional). Esto sigue el mismo patrón que `markDebtPaid` de Fase 3 y evita gastos huérfanos con `hasProof=true` sin comprobante real si la subida fallara.

### Addendum (2026-07-13): cambio de proveedor OCR, de OpenAI GPT-4o a `gemma4` (nan.builders)

Decisión del usuario: sustituir OpenAI GPT-4o Vision por `gemma4` (26B, 4B activos, multimodal), servido por `nan.builders` (`https://api.nan.builders/v1`, API compatible con OpenAI). Motivo: el usuario ya tiene acceso a ese modelo vía una plataforma de comunidad, sin coste de pago-por-uso.

- **Verificado por primera vez contra una API real**, cerrando el `⚠️` de arriba — no con OpenAI, sino con el nuevo proveedor. Prueba en vivo con una imagen de ticket sintética (ferretería, importe 66,90€, IVA 11,61€): HTTP 200, ~2.5s de latencia, extracción exacta en los 6 campos.
- **`response_format: json_schema` en modo `strict` funciona igual que con OpenAI** — pese a que la documentación de nan.builders describe el tool/function calling de `gemma4` como "formato XML", el structured output vía `response_format` sí devolvió JSON válido a la primera. Cambio de proveedor prácticamente drop-in: mismo payload, solo cambia `model` y la base URL.
- **Variable de entorno renombrada**: `OPENAI_API_KEY` → `NAN_BUILDERS_API_KEY` en `server/utils/env.ts`, `.env.example` y `docs/system-architecture.md`.
- **`PRICE_PER_IMAGE_USD` pasa de `0.03` a `0`**: nan.builders es un servicio de comunidad con cuota mensual de tokens por miembro (500M tokens/miembro según su doc), no facturación por uso — no hay coste real que registrar por llamada. El campo `costUsd` en `expenses.ocrCostUsd` seguirá existiendo por compatibilidad con el schema, pero siempre será `0` mientras se use este proveedor.
- **Pendiente de re-verificar** (no bloqueante, mismo ítem 👤 de antes, ahora contra el nuevo proveedor): subir 3-5 fotos de tickets REALES (no sintéticos) tomadas con el móvil y validar que la extracción de `gemma4` es suficientemente precisa para el uso diario — la prueba realizada usó una imagen sintética generada por ordenador, no una foto real con las imperfecciones habituales (ángulo, sombras, arrugas).
- **`confidence`/`costUsd` los reenvía el cliente sin re-verificación server-side contra la llamada real** (hallazgo medio de code review, aceptado como trade-off de MVP dado que solo admin/owner pueden llamar a este endpoint): si el registro de coste se vuelve operacionalmente importante (alertas de gasto), habría que cachear el resultado de `/api/ocr/extract` server-side en vez de confiar en los campos que reenvía el formulario.
