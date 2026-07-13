import { z } from 'zod'
import { closeProposal } from '../../../services/proposal-service'
import { requireRole } from '../../../utils/rbac'

const bodySchema = z.object({ overrideQuoteId: z.string().min(1).optional() })

export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner'])
  const proposalId = getRouterParam(event, 'id')
  if (!proposalId) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de propuesta' })
  }

  const parsed = bodySchema.safeParse((await readBody(event)) ?? {})
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Datos inválidos', data: parsed.error.flatten() })
  }

  const proposal = await closeProposal({
    proposalId,
    actorId: actor.id,
    actorRole: actor.role,
    overrideQuoteId: parsed.data.overrideQuoteId
  })
  return { proposal }
})
