import { eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { debts, expenses } from '../../db/schema'
import { canSeeIndividualDebt, requireRole } from '../../utils/rbac'

export default defineEventHandler(async (event) => {
  const user = requireRole(event, ['admin', 'owner', 'guest'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de gasto' })
  }

  const expense = await db.query.expenses.findFirst({ where: eq(expenses.id, id) })
  if (!expense) {
    throw createError({ statusCode: 404, statusMessage: 'Gasto no encontrado' })
  }

  if (!canSeeIndividualDebt(user)) {
    // participantSnapshot contiene el desglose por persona — nunca se expone al Invitado.
    const { participantSnapshot: _participantSnapshot, ...aggregate } = expense
    return { expense: aggregate }
  }

  const expenseDebts = await db.query.debts.findMany({ where: eq(debts.expenseId, id) })
  return { expense: { ...expense, debts: expenseDebts } }
})
