import { desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { db } from '../../db/client'
import { bankTransactions, contributions, expenses, ideas, proposals, tasks, users } from '../../db/schema'
import { requireRole } from '../../utils/rbac'

// Papelera (fase 8): todo lo que está borrado de forma lógica, en un único listado para el
// Admin. Aquí sí se leen las filas con `deletedAt` — es el único sitio del servidor que lo
// hace a propósito. El borrado definitivo (purge) solo se puede lanzar desde esta pantalla.
export default defineEventHandler(async (event) => {
  requireRole(event, ['admin'])

  const [discardedIdeas, cancelledProposals, discardedTasks, trashedTransactions, trashedContributions, trashedExpenses] = await Promise.all([
    db.query.ideas.findMany({ where: eq(ideas.status, 'discarded') }),
    db.query.proposals.findMany({ where: eq(proposals.status, 'cancelled') }),
    db.query.tasks.findMany({ where: isNotNull(tasks.discardedAt) }),
    db.select().from(bankTransactions).where(isNotNull(bankTransactions.deletedAt)).orderBy(desc(bankTransactions.deletedAt)),
    db.select().from(contributions).where(isNotNull(contributions.deletedAt)).orderBy(desc(contributions.deletedAt)),
    db.select().from(expenses).where(isNotNull(expenses.deletedAt)).orderBy(desc(expenses.deletedAt))
  ])

  // Nombres de miembro para los aportes (una sola consulta, sin N+1).
  const memberIds = [...new Set(trashedContributions.map(c => c.memberId))]
  const memberRows = memberIds.length > 0
    ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, memberIds))
    : []
  const nameById = new Map(memberRows.map(u => [u.id, u.name]))

  return {
    ideas: discardedIdeas.map(i => ({ id: i.id, title: i.title, discardedAt: i.updatedAt })),
    // closedAt siempre se rellena al cancelar (server/services/proposal-service.ts,
    // cancelProposal) — sin fallback deliberado: si algún día falta, es un bug a detectar,
    // no algo que enmascarar con updatedAt (que cambia por otros motivos).
    proposals: cancelledProposals.map(p => ({ id: p.id, title: p.title, discardedAt: p.closedAt })),
    tasks: discardedTasks.map(t => ({ id: t.id, title: t.title, discardedAt: t.discardedAt })),
    transactions: trashedTransactions.map(t => ({
      id: t.id,
      title: t.description,
      amountCents: t.amountCents,
      direction: t.direction,
      date: t.date,
      // Mes del cargo automático de la hipoteca: avisa de que purgarlo no lo regenera.
      mortgagePeriod: t.mortgagePeriod,
      discardedAt: t.deletedAt
    })),
    contributions: trashedContributions.map(c => ({
      id: c.id,
      title: `Aporte ${c.type === 'quota' ? `cuota ${c.period ?? ''}` : c.type === 'pre_purchase' ? 'pre-compra' : 'extraordinario'} — ${nameById.get(c.memberId) ?? c.memberId}`,
      amountCents: c.amountCents,
      date: c.date,
      discardedAt: c.deletedAt
    })),
    expenses: trashedExpenses.map(e => ({
      id: e.id,
      title: e.description,
      amountCents: e.amountCents,
      type: e.type,
      discardedAt: e.deletedAt
    }))
  }
})
