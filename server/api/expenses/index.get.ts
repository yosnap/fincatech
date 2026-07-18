import { desc } from 'drizzle-orm'
import { db } from '../../db/client'
import { expenses } from '../../db/schema'
import { canSeeIndividualDebt, requireRole } from '../../utils/rbac'
import { getUserNameMap } from '../../utils/user-names'

// El Invitado ve el libro contable, pero nunca el desglose individual (quién debe a quién).
// El autor (createdByName) sí es visible para todos los roles: no es información de deuda.
export default defineEventHandler(async (event) => {
  const user = requireRole(event, ['admin', 'owner', 'guest'])

  const rows = await db.query.expenses.findMany({ orderBy: [desc(expenses.createdAt)] })
  const nameMap = await getUserNameMap(rows.map(e => e.createdBy))

  if (!canSeeIndividualDebt(user)) {
    return {
      expenses: rows.map(e => ({
        id: e.id,
        description: e.description,
        amountCents: e.amountCents,
        type: e.type,
        hasProof: e.hasProof,
        status: e.status,
        createdByName: nameMap.get(e.createdBy) ?? e.createdBy,
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
      createdByName: nameMap.get(e.createdBy) ?? e.createdBy,
      createdAt: e.createdAt,
      debts: allDebts
        .filter(d => d.expenseId === e.id)
        .map(d => ({ id: d.id, debtorId: d.debtorId, creditorId: d.creditorId, amountCents: d.amountCents, status: d.status }))
    }))
  }
})
