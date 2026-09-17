import { eq, inArray } from 'drizzle-orm'
import { db } from '../../../db/client'
import { bankTransactions, contributions, users } from '../../../db/schema'
import { requireRole } from '../../../utils/rbac'

// Lista de aportes: cada autenticado ve siempre los SUYOS; Admin/Propietario ven todos
// (mismo criterio de desglose individual que canSeeIndividualDebt — el Invitado no ve el
// grid de contribuciones de otros miembros).
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner', 'guest'])
  const canSeeAll = actor.role === 'admin' || actor.role === 'owner'

  const rows = canSeeAll
    ? await db.select().from(contributions)
    : await db.select().from(contributions).where(eq(contributions.memberId, actor.id))

  // Enriquecer con nombres (miembro y quién lo registró) y con el ingreso vinculado para
  // mostrar el estado de depósito sin N+1 consultas por fila.
  const userIds = [...new Set(rows.flatMap(c => [c.memberId, c.registeredBy]))]
  const transactionIds = [...new Set(rows.map(c => c.bankTransactionId).filter((id): id is string => id !== null))]

  const [userRows, transactionRows] = await Promise.all([
    userIds.length > 0
      ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds))
      : Promise.resolve([] as { id: string, name: string }[]),
    transactionIds.length > 0
      ? db.select({
          id: bankTransactions.id,
          date: bankTransactions.date,
          amountCents: bankTransactions.amountCents,
          description: bankTransactions.description
        }).from(bankTransactions).where(inArray(bankTransactions.id, transactionIds))
      : Promise.resolve([] as { id: string, date: string, amountCents: number, description: string }[])
  ])

  const nameById = new Map(userRows.map(u => [u.id, u.name]))
  const transactionById = new Map(transactionRows.map(t => [t.id, t]))

  return {
    contributions: rows.map(c => ({
      ...c,
      memberName: nameById.get(c.memberId) ?? c.memberId,
      registeredByName: nameById.get(c.registeredBy) ?? c.registeredBy,
      bankTransaction: c.bankTransactionId ? transactionById.get(c.bankTransactionId) ?? null : null
    }))
  }
})
