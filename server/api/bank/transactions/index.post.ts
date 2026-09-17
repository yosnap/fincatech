import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { isValidCalendarDate } from '../../../services/bank-core'
import { createTransaction } from '../../../services/bank-service'
import { deleteFile, uploadFile } from '../../../services/storage'
import { matchesDeclaredType } from '../../../utils/file-signature'
import { requireRole } from '../../../utils/rbac'

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf'])
const MAX_SIZE_BYTES = 10 * 1024 * 1024
// Tope defensivo muy por encima de cualquier movimiento real (int4 de Postgres muere por
// encima de ~21,4M€ con un 500 feo — mejor un 400 claro).
const MAX_AMOUNT_CENTS = 100_000_000

const fieldsSchema = z.object({
  date: z.string().refine(isValidCalendarDate, 'Fecha de calendario inválida'),
  direction: z.enum(['deposit', 'withdrawal']),
  amountCents: z.coerce.number().int().positive().max(MAX_AMOUNT_CENTS),
  description: z.string().min(1),
  // Solo depósitos: categoría de ingreso externo. Un aporte de miembro no lleva categoría.
  category: z.enum(['hacienda', 'ayuntamiento', 'impuestos', 'iva', 'otro']).optional()
}).refine(body => body.direction === 'deposit' || body.category === undefined, {
  message: 'Las salidas no llevan categoría',
  path: ['category']
})

// Alta de movimiento bancario (solo Admin = tesorero, decisión de producto). Multipart con
// justificante OPCIONAL: se puede adjuntar después desde la lista ([id]/proof.post).
// Misma validación de archivo que expenses (whitelist + 10MB + magic bytes).
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])

  const formData = await readMultipartFormData(event)
  const rawFields: Record<string, string> = {}
  for (const part of formData ?? []) {
    if (part.name && part.name !== 'proof') rawFields[part.name] = Buffer.from(part.data).toString('utf8')
  }
  const parsed = fieldsSchema.safeParse(rawFields)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Datos inválidos', data: parsed.error.flatten() })
  }
  const body = parsed.data

  const file = formData?.find(part => part.name === 'proof')
  let proof: { objectName: string, contentType: string } | undefined

  if (file?.type && file.type !== 'application/octet-stream') {
    if (!ALLOWED_TYPES.has(file.type)) {
      throw createError({ statusCode: 400, statusMessage: 'Justificante inválido (JPEG, PNG o PDF)' })
    }
    const buffer = Buffer.from(file.data)
    if (buffer.length > MAX_SIZE_BYTES) {
      throw createError({ statusCode: 400, statusMessage: 'El justificante supera el límite de 10MB' })
    }
    if (!matchesDeclaredType(buffer, file.type)) {
      throw createError({ statusCode: 400, statusMessage: 'El archivo no coincide con el tipo declarado' })
    }
    const extension = file.type === 'application/pdf' ? 'pdf' : file.type.split('/')[1]
    const objectName = `bank/transactions/${randomUUID()}.${extension}`
    // Upload a MinIO ANTES de escribir en DB (patrón expenses): si la inserción falla, el
    // objeto huérfano se limpia en el catch; al revés quedaría una fila sin archivo.
    try {
      await uploadFile(objectName, buffer, file.type)
    } catch {
      throw createError({ statusCode: 500, statusMessage: 'No se pudo subir el justificante' })
    }
    proof = { objectName, contentType: file.type }
  }

  try {
    const transaction = await createTransaction({
      actorId: actor.id,
      date: body.date,
      direction: body.direction,
      amountCents: body.amountCents,
      description: body.description,
      category: body.category ?? null,
      proof
    })
    return { transaction }
  } catch (error) {
    // La inserción falló: el objeto de MinIO subido queda huérfano, se limpia.
    if (proof) await deleteFile(proof.objectName).catch(() => null)
    throw error
  }
})
