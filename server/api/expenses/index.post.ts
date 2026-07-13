import { inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db/client'
import { users } from '../../db/schema'
import { createExpense } from '../../services/expense-service'
import { requireRole } from '../../utils/rbac'

const bodySchema = z.object({
  amountCents: z.number().int().positive(),
  taxCents: z.number().int().min(0).optional(),
  description: z.string().min(1),
  type: z.enum(['manual', 'bank_receipt']),
  participantIds: z.array(z.string().min(1)).min(1),
  hasProof: z.boolean()
})

// Solo Admin/Propietario crean gastos (PRD §3.3: el Invitado no puede crear ni editar).
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
  const invalidIds = body.participantIds.filter(id => !validIds.has(id))
  if (invalidIds.length > 0) {
    throw createError({ statusCode: 400, statusMessage: 'Participantes inválidos: deben ser miembros activos (admin/owner)' })
  }

  const expense = await createExpense({
    actorId: actor.id,
    amountCents: body.amountCents,
    taxCents: body.taxCents,
    description: body.description,
    type: body.type,
    participantIds: body.participantIds,
    hasProof: body.hasProof
  })

  return { expense }
})
