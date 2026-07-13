import { z } from 'zod'
import { castVote } from '../../../services/proposal-service'
import { requireRole } from '../../../utils/rbac'

const bodySchema = z.object({ quoteId: z.string().min(1) })

// El Invitado no vota (PRD §3.3, RBAC Fase 2).
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner'])
  const proposalId = getRouterParam(event, 'id')
  if (!proposalId) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de propuesta' })
  }

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Datos inválidos', data: parsed.error.flatten() })
  }

  await castVote({ proposalId, quoteId: parsed.data.quoteId, voterId: actor.id })
  return { ok: true }
})
