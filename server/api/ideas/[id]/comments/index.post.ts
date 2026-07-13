import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../../../db/client'
import { ideaComments, ideas } from '../../../../db/schema'
import { requireRole } from '../../../../utils/rbac'

const bodySchema = z.object({ body: z.string().min(1) })

// El Invitado no comenta (PRD §3.3).
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner'])
  const ideaId = getRouterParam(event, 'id')
  if (!ideaId) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de idea' })
  }

  const idea = await db.query.ideas.findFirst({ where: eq(ideas.id, ideaId) })
  if (!idea) {
    throw createError({ statusCode: 404, statusMessage: 'Idea no encontrada' })
  }

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Datos inválidos', data: parsed.error.flatten() })
  }

  const [comment] = await db.insert(ideaComments)
    .values({ ideaId, authorId: actor.id, body: parsed.data.body })
    .returning()

  return { comment }
})
