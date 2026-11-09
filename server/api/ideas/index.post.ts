import { createIdea, createIdeaSchema } from '../../services/idea-service'
import { requireRole } from '../../utils/rbac'

// El Invitado no crea ideas (PRD §3.3).
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner'])

  const parsed = createIdeaSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Datos inválidos', data: parsed.error.flatten() })
  }

  return { idea: await createIdea({ actor, ...parsed.data }) }
})
