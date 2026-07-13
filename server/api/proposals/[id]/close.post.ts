import { z } from 'zod'
import { db } from '../../../db/client'
import { executeApprovedProposalCore } from '../../../services/assessment-service'
import { closeProposalCore } from '../../../services/proposal-service'
import { requireRole } from '../../../utils/rbac'

const bodySchema = z.object({ overrideQuoteId: z.string().min(1).optional() })

// Cerrar una propuesta y ejecutar la derrama+tarea resultante son UNA sola transacción
// (hallazgo de code review: dos transacciones separadas dejaban una ventana donde la
// propuesta podía quedar 'approved' sin derrama/tarea si la segunda fallaba). Ambos núcleos
// son idempotentes, así que repetir la llamada nunca duplica nada.
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

  const { proposal, expense, task } = await db.transaction(async (tx) => {
    const proposal = await closeProposalCore(tx, {
      proposalId,
      actorId: actor.id,
      actorRole: actor.role,
      overrideQuoteId: parsed.data.overrideQuoteId
    })
    const { expense, task } = await executeApprovedProposalCore(tx, { proposalId, actorId: actor.id })
    return { proposal, expense, task }
  })

  return { proposal, expense, task }
})
