import { eq, isNotNull } from 'drizzle-orm'
import { db } from '../../db/client'
import { ideas, proposals, tasks } from '../../db/schema'
import { requireRole } from '../../utils/rbac'

export default defineEventHandler(async (event) => {
  requireRole(event, ['admin'])

  const [discardedIdeas, cancelledProposals, discardedTasks] = await Promise.all([
    db.query.ideas.findMany({ where: eq(ideas.status, 'discarded') }),
    db.query.proposals.findMany({ where: eq(proposals.status, 'cancelled') }),
    db.query.tasks.findMany({ where: isNotNull(tasks.discardedAt) })
  ])

  return {
    ideas: discardedIdeas.map(i => ({ id: i.id, title: i.title, discardedAt: i.updatedAt })),
    // closedAt siempre se rellena al cancelar (server/services/proposal-service.ts,
    // cancelProposal) — sin fallback deliberado: si algún día falta, es un bug a detectar,
    // no algo que enmascarar con updatedAt (que cambia por otros motivos).
    proposals: cancelledProposals.map(p => ({ id: p.id, title: p.title, discardedAt: p.closedAt })),
    tasks: discardedTasks.map(t => ({ id: t.id, title: t.title, discardedAt: t.discardedAt }))
  }
})
