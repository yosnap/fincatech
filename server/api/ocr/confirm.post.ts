import { randomUUID } from 'node:crypto'
import { inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db/client'
import { users } from '../../db/schema'
import { createExpense } from '../../services/expense-service'
import { uploadFile } from '../../services/storage'
import { matchesDeclaredType } from '../../utils/file-signature'
import { requireRole } from '../../utils/rbac'

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png'])
const MAX_SIZE_BYTES = 10 * 1024 * 1024

const fieldsSchema = z.object({
  description: z.string().min(1),
  amountCents: z.coerce.number().int().positive(),
  taxCents: z.coerce.number().int().min(0).optional(),
  participantIds: z.string().transform(raw => JSON.parse(raw) as unknown).pipe(z.array(z.string().min(1)).min(1)),
  confidence: z.coerce.number().min(0).max(1),
  costUsd: z.coerce.number().min(0)
})

// Nunca crea el gasto directamente desde la extracción OCR: el humano ya revisó/corrigió
// los campos en la pantalla de revisión (human-in-the-loop obligatorio, PRD/plan Fase 4).
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner'])

  const formData = await readMultipartFormData(event)
  const file = formData?.find(part => part.name === 'file')
  if (!file?.type || !ALLOWED_TYPES.has(file.type)) {
    throw createError({ statusCode: 400, statusMessage: 'Falta la imagen del ticket' })
  }
  const buffer = Buffer.from(file.data)
  if (buffer.length > MAX_SIZE_BYTES) {
    throw createError({ statusCode: 400, statusMessage: 'La imagen supera el límite de 10MB' })
  }
  if (!matchesDeclaredType(buffer, file.type)) {
    throw createError({ statusCode: 400, statusMessage: 'El archivo no coincide con el tipo declarado' })
  }

  const rawFields: Record<string, string> = {}
  for (const part of formData ?? []) {
    if (part.name && part.name !== 'file') rawFields[part.name] = Buffer.from(part.data).toString('utf8')
  }
  const parsed = fieldsSchema.safeParse(rawFields)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Datos inválidos', data: parsed.error.flatten() })
  }
  const body = parsed.data

  const participants = await db.select({ id: users.id, role: users.role, banned: users.banned })
    .from(users)
    .where(inArray(users.id, body.participantIds))
  const validIds = new Set(
    participants.filter(p => !p.banned && (p.role === 'admin' || p.role === 'owner')).map(p => p.id)
  )
  if (body.participantIds.some(id => !validIds.has(id))) {
    throw createError({ statusCode: 400, statusMessage: 'Participantes inválidos: deben ser miembros activos (admin/owner)' })
  }

  // Subir ANTES de escribir en DB (igual que markDebtPaid en Fase 3): si la subida falla,
  // no se crea ningún gasto huérfano con hasProof=true sin comprobante real.
  const objectName = `expenses/ocr/${randomUUID()}.${file.type.split('/')[1]}`
  await uploadFile(objectName, buffer, file.type)

  const expense = await createExpense({
    actorId: actor.id,
    amountCents: body.amountCents,
    description: body.description,
    type: 'manual',
    participantIds: body.participantIds,
    hasProof: true,
    taxCents: body.taxCents,
    ocrConfidence: body.confidence,
    ocrCostUsd: body.costUsd,
    proof: { objectName, contentType: file.type }
  })

  return { expense }
})
