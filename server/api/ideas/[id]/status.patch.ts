import { changeIdeaStatus, ideaStatusSchema } from '../../../services/idea-service'
import { requireRole } from '../../../utils/rbac'

// Solo Admin o el autor cambian el estado; las reglas (descartada final, promovida solo
// archivable) viven en server/services/idea-service.ts.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de idea' })
  }

  const parsed = ideaStatusSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Datos inválidos', data: parsed.error.flatten() })
  }

  return { idea: await changeIdeaStatus({ actor, ideaId: id, status: parsed.data.status }) }
})
