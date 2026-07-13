import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../../../db/client'
import { proposals, quotes } from '../../../../db/schema'
import { uploadFile } from '../../../../services/storage'
import { matchesDeclaredType } from '../../../../utils/file-signature'
import { requireRole } from '../../../../utils/rbac'

const MAX_SIZE_BYTES = 10 * 1024 * 1024

const fieldsSchema = z.object({
  label: z.string().min(1),
  priceCents: z.coerce.number().int().positive(),
  conditions: z.string().optional()
})

export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner'])
  const proposalId = getRouterParam(event, 'id')
  if (!proposalId) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de propuesta' })
  }

  const proposal = await db.query.proposals.findFirst({ where: eq(proposals.id, proposalId) })
  if (!proposal) {
    throw createError({ statusCode: 404, statusMessage: 'Propuesta no encontrada' })
  }
  if (proposal.status !== 'voting') {
    throw createError({ statusCode: 400, statusMessage: 'La votación de esta propuesta ya está cerrada' })
  }

  const formData = await readMultipartFormData(event)
  const rawFields: Record<string, string> = {}
  for (const part of formData ?? []) {
    if (part.name && part.name !== 'attachment') rawFields[part.name] = Buffer.from(part.data).toString('utf8')
  }
  const parsed = fieldsSchema.safeParse(rawFields)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Datos inválidos', data: parsed.error.flatten() })
  }

  const file = formData?.find(part => part.name === 'attachment')
  let attachmentObjectName: string | undefined
  if (file?.type) {
    if (file.type !== 'application/pdf') {
      throw createError({ statusCode: 400, statusMessage: 'El adjunto de la cotización debe ser un PDF' })
    }
    const buffer = Buffer.from(file.data)
    if (buffer.length > MAX_SIZE_BYTES) {
      throw createError({ statusCode: 400, statusMessage: 'El PDF supera el límite de 10MB' })
    }
    if (!matchesDeclaredType(buffer, file.type)) {
      throw createError({ statusCode: 400, statusMessage: 'El archivo no coincide con el tipo declarado' })
    }
    attachmentObjectName = `proposals/${proposalId}/${randomUUID()}.pdf`
    await uploadFile(attachmentObjectName, buffer, file.type)
  }

  const [quote] = await db.insert(quotes).values({
    proposalId,
    label: parsed.data.label,
    priceCents: parsed.data.priceCents,
    conditions: parsed.data.conditions ?? null,
    attachmentObjectName: attachmentObjectName ?? null,
    createdBy: actor.id
  }).returning()

  return { quote }
})
