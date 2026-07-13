import { inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db/client'
import { users } from '../../db/schema'
import { createExpense } from '../../services/expense-service'
import { objectExists } from '../../services/storage'
import { requireRole } from '../../utils/rbac'

// El objectName viaja en la URL que generó nuestro propio webhook, pero llega aquí como
// texto libre del cliente (query param editable) — restringimos el prefijo esperado y
// verificamos que el objeto exista de verdad en MinIO antes de crear el gasto, para no
// terminar con un expense con hasProof=true apuntando a un comprobante inexistente.
const OBJECT_NAME_PATTERN = /^expenses\/telegram\/[a-zA-Z0-9-]+\.(jpg|png)$/

const bodySchema = z.object({
  objectName: z.string().regex(OBJECT_NAME_PATTERN, 'Referencia de comprobante inválida'),
  contentType: z.enum(['image/jpeg', 'image/png']),
  description: z.string().min(1),
  amountCents: z.number().int().positive(),
  taxCents: z.number().int().min(0).optional(),
  participantIds: z.array(z.string().min(1)).min(1),
  confidence: z.number().min(0).max(1),
  costUsd: z.number().min(0)
})

// Variante de confirm.post.ts (Fase 4) para el flujo del bot de Telegram: el comprobante ya
// está subido a MinIO por el webhook (server/routes/webhook/telegram.post.ts), así que aquí
// no se recibe ningún archivo, solo la referencia + los campos ya revisados por el humano.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner'])

  const parsed = bodySchema.safeParse(await readBody(event))
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

  if (!(await objectExists(body.objectName))) {
    throw createError({ statusCode: 400, statusMessage: 'El comprobante no existe o ya expiró; envía la foto de nuevo al bot' })
  }

  const expense = await createExpense({
    actorId: actor.id,
    amountCents: body.amountCents,
    taxCents: body.taxCents,
    description: body.description,
    type: 'manual',
    participantIds: body.participantIds,
    hasProof: true,
    ocrConfidence: body.confidence,
    ocrCostUsd: body.costUsd,
    proof: { objectName: body.objectName, contentType: body.contentType }
  })

  return { expense }
})
