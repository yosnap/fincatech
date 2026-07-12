import { desc } from 'drizzle-orm'
import { db } from '../../db/client'
import { expenses } from '../../db/schema'
import { canSeeIndividualDebt, requireRole } from '../../utils/rbac'

// El Invitado ve el libro contable, pero nunca el desglose individual (quién debe a quién).
export default defineEventHandler(async (event) => {
  const user = requireRole(event, ['admin', 'owner', 'guest'])

  const rows = await db.query.expenses.findMany({ orderBy: [desc(expenses.createdAt)] })

  if (!canSeeIndividualDebt(user)) {
    return {
      expenses: rows.map(e => ({
        id: e.id,
        description: e.description,
        amountCents: e.amountCents,
        type: e.type,
        hasProof: e.hasProof,
        status: e.status,
        createdAt: e.createdAt
      }))
    }
  }

  const allDebts = await db.query.debts.findMany()
  return {
    expenses: rows.map(e => ({
      id: e.id,
      description: e.description,
      amountCents: e.amountCents,
      type: e.type,
      hasProof: e.hasProof,
      status: e.status,
      createdBy: e.createdBy,
      createdAt: e.createdAt,
      debts: allDebts
        .filter(d => d.expenseId === e.id)
        .map(d => ({ id: d.id, debtorId: d.debtorId, creditorId: d.creditorId, amountCents: d.amountCents, status: d.status }))
    }))
  }
})
