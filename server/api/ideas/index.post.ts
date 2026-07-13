import { z } from 'zod'
import { db } from '../../db/client'
import { ideas } from '../../db/schema'
import { requireRole } from '../../utils/rbac'

const bodySchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1)
})

// El Invitado no crea ideas (PRD §3.3).
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner'])

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Datos inválidos', data: parsed.error.flatten() })
  }

  const [idea] = await db.insert(ideas)
    .values({ title: parsed.data.title, description: parsed.data.description, authorId: actor.id })
    .returning()

  return { idea }
})
