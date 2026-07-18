import { randomUUID } from 'node:crypto'
import { inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db/client'
import { users } from '../../db/schema'
import { createExpense } from '../../services/expense-service'
import { uploadFile } from '../../services/storage'
import { matchesDeclaredType } from '../../utils/file-signature'
import { requireRole } from '../../utils/rbac'

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf'])
const MAX_SIZE_BYTES = 10 * 1024 * 1024

const fieldsSchema = z.object({
  amountCents: z.coerce.number().int().positive(),
  taxCents: z.coerce.number().int().min(0).optional(),
  description: z.string().min(1),
  type: z.enum(['manual', 'bank_receipt']),
  participantIds: z.string().transform(raw => JSON.parse(raw) as unknown).pipe(z.array(z.string().min(1)).min(1)),
  hasProof: z.enum(['true', 'false']).transform(v => v === 'true')
})

// Solo Admin/Propietario crean gastos (PRD §3.3: el Invitado no puede crear ni editar).
// Multipart en vez de JSON: si marcan "tengo comprobante" hay que subir el archivo real
// del ticket en el momento, no basta con el booleano (antes quedaba huérfano de archivo).
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner'])

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

  if (body.hasProof) {
    if (!file?.type || !ALLOWED_TYPES.has(file.type)) {
      throw createError({ statusCode: 400, statusMessage: 'Justificante requerido (JPEG, PNG o PDF)' })
    }
    const buffer = Buffer.from(file.data)
    if (buffer.length > MAX_SIZE_BYTES) {
      throw createError({ statusCode: 400, statusMessage: 'El justificante supera el límite de 10MB' })
    }
    if (!matchesDeclaredType(buffer, file.type)) {
      throw createError({ statusCode: 400, statusMessage: 'El archivo no coincide con el tipo declarado' })
    }
    const extension = file.type === 'application/pdf' ? 'pdf' : file.type.split('/')[1]
    const objectName = `expenses/manual/${randomUUID()}.${extension}`
    await uploadFile(objectName, buffer, file.type)
    proof = { objectName, contentType: file.type }
  }

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
    hasProof: body.hasProof,
    proof
  })

  return { expense }
})
