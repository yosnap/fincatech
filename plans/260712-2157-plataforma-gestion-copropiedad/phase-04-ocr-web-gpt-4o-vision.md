---
phase: 4
title: "OCR web con GPT-4o Vision"
status: pending
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
- **Estado de implementación:** Pendiente
- **Estado de revisión:** No revisado

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
- [ ] Schema zod de extracción estructurada
- [ ] `vision-ocr` service con Structured Outputs + validación
- [ ] Endpoint extract con validación de archivo previa (control de coste)
- [ ] UI drag-drop + pantalla de revisión editable
- [ ] Integración con createExpense (Fase 3) + guardar comprobante
- [ ] Registro de confidence y coste por llamada
- [ ] Fallback a manual si falla/low-confidence

## Success Criteria
- [ ] Ticket legible se extrae en JSON válido y precarga la pantalla de revisión.
- [ ] Ningún gasto se crea sin confirmación humana.
- [ ] Archivos de tipo/tamaño inválido se rechazan antes de llamar a la API.
- [ ] Fallo de la API degrada a entrada manual sin bloquear al usuario.
- [ ] Se registra confidence y coste por extracción.

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
