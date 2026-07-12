import { extractReceiptData, isOcrConfigured } from '../../services/vision-ocr'
import { matchesDeclaredType } from '../../utils/file-signature'
import { requireRole } from '../../utils/rbac'

// Solo imágenes: la API de Vision de chat completions no acepta PDF directamente (requeriría
// rasterizar la primera página, fuera de alcance MVP — ver nota en el plan de Fase 4).
// Un PDF de factura se registra manualmente (Fase 3), no vía OCR.
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png'])
const MAX_SIZE_BYTES = 10 * 1024 * 1024

export default defineEventHandler(async (event) => {
  requireRole(event, ['admin', 'owner'])

  if (!isOcrConfigured()) {
    throw createError({ statusCode: 503, statusMessage: 'OCR no disponible ahora mismo. Usa el registro manual de gastos.' })
  }

  const formData = await readMultipartFormData(event)
  const file = formData?.find(part => part.name === 'file')
  if (!file?.type || !ALLOWED_TYPES.has(file.type)) {
    throw createError({ statusCode: 400, statusMessage: 'Sube una imagen JPEG o PNG del ticket (PDF: usa el registro manual)' })
  }
  // Tamaño y firma se validan ANTES de llamar a la API — cada llamada tiene coste real.
  if (file.data.length > MAX_SIZE_BYTES) {
    throw createError({ statusCode: 400, statusMessage: 'La imagen supera el límite de 10MB' })
  }
  const buffer = Buffer.from(file.data)
  if (!matchesDeclaredType(buffer, file.type)) {
    throw createError({ statusCode: 400, statusMessage: 'El archivo no coincide con el tipo declarado' })
  }

  const result = await extractReceiptData(buffer.toString('base64'), file.type)

  return { extraction: result.extraction, costUsd: result.costUsd }
})
