import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client'
import { referenceLinks } from '../db/schema'

export type ReferenceEntityType = 'idea' | 'proposal' | 'task'

// Solo http(s): un esquema como javascript:/data: guardado aquí se renderizaría tal cual
// en un <a href> con target="_blank" en el frontend (app/components/ReferenceLinksCard.vue).
export const referenceLinkBodySchema = z.object({
  url: z.string().url().refine(u => /^https?:\/\//i.test(u), 'Solo se admiten URLs http:// o https://'),
  label: z.string().max(200).optional()
})

interface AddReferenceLinkInput {
  entityType: ReferenceEntityType
  entityId: string
  url: string
  label?: string
  addedBy: string
}

export async function addReferenceLink(input: AddReferenceLinkInput) {
  const [link] = await db.insert(referenceLinks).values({
    entityType: input.entityType,
    entityId: input.entityId,
    url: input.url,
    label: input.label ?? null,
    addedBy: input.addedBy
  }).returning()
  if (!link) {
    throw createError({ statusCode: 500, statusMessage: 'No se pudo guardar el enlace' })
  }
  return link
}

export async function listReferenceLinks(entityType: ReferenceEntityType, entityId: string) {
  return db.query.referenceLinks.findMany({
    where: and(eq(referenceLinks.entityType, entityType), eq(referenceLinks.entityId, entityId)),
    orderBy: [desc(referenceLinks.createdAt)]
  })
}

interface DeleteReferenceLinkInput {
  entityType: ReferenceEntityType
  entityId: string
  linkId: string
  actorId: string
  actorRole: string
}

export async function deleteReferenceLink(input: DeleteReferenceLinkInput) {
  const link = await db.query.referenceLinks.findFirst({
    where: and(
      eq(referenceLinks.id, input.linkId),
      eq(referenceLinks.entityType, input.entityType),
      eq(referenceLinks.entityId, input.entityId)
    )
  })
  if (!link) {
    throw createError({ statusCode: 404, statusMessage: 'Enlace no encontrado' })
  }
  if (input.actorRole !== 'admin' && link.addedBy !== input.actorId) {
    throw createError({ statusCode: 403, statusMessage: 'Solo quien añadió el enlace o un Admin puede borrarlo' })
  }
  await db.delete(referenceLinks).where(eq(referenceLinks.id, input.linkId))
}
