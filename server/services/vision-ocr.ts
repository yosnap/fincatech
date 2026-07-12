import { z } from 'zod'
import { getEnv } from '../utils/env'

export const ocrExtractionSchema = z.object({
  date: z.string().nullable(),
  vendor: z.string().nullable(),
  amountCents: z.number().int().nullable(),
  taxCents: z.number().int().nullable(),
  concept: z.string().nullable(),
  confidence: z.number().min(0).max(1)
})
export type OcrExtraction = z.infer<typeof ocrExtractionSchema>

export interface OcrResult {
  extraction: OcrExtraction
  costUsd: number
}

const MODEL = 'gpt-4o'
// Aproximado a fecha de esta fase — revisar rate card de OpenAI trimestralmente (Risk
// Assessment del plan de Fase 4). No se factura por esto, es solo para registrar coste.
const PRICE_PER_IMAGE_USD = 0.03

export function isOcrConfigured(): boolean {
  return !!getEnv().OPENAI_API_KEY
}

// Única puerta a la API Vision — reutilizable por el bot de Telegram (Fase 5).
export async function extractReceiptData(imageBase64: string, mimeType: string): Promise<OcrResult> {
  const env = getEnv()
  if (!env.OPENAI_API_KEY) {
    throw createError({ statusCode: 503, statusMessage: 'OCR no configurado (falta OPENAI_API_KEY)' })
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Extrae los datos de este ticket o factura: fecha de emisión (ISO 8601), nombre del proveedor, importe total en céntimos enteros, impuestos en céntimos enteros, concepto principal. Si un campo no es legible, usa null. Incluye tu confianza global (0 a 1) en la extracción.'
            },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } }
          ]
        }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'receipt_extraction',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              date: { type: ['string', 'null'] },
              vendor: { type: ['string', 'null'] },
              amountCents: { type: ['integer', 'null'] },
              taxCents: { type: ['integer', 'null'] },
              concept: { type: ['string', 'null'] },
              confidence: { type: 'number' }
            },
            required: ['date', 'vendor', 'amountCents', 'taxCents', 'concept', 'confidence'],
            additionalProperties: false
          }
        }
      }
    })
  })

  if (!response.ok) {
    throw createError({ statusCode: 502, statusMessage: 'Fallo al llamar a la API de OCR' })
  }

  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
  const content = body.choices?.[0]?.message?.content
  if (!content) {
    throw createError({ statusCode: 502, statusMessage: 'Respuesta de OCR vacía' })
  }

  let rawExtraction: unknown
  try {
    rawExtraction = JSON.parse(content)
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'La respuesta de OCR no es JSON válido' })
  }

  const parsed = ocrExtractionSchema.safeParse(rawExtraction)
  if (!parsed.success) {
    throw createError({ statusCode: 502, statusMessage: 'La extracción de OCR no cumple el formato esperado' })
  }

  return { extraction: parsed.data, costUsd: PRICE_PER_IMAGE_USD }
}
