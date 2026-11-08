import { and, inArray } from 'drizzle-orm'
import { db } from '../../../db/client'
import { bankTransactions, users } from '../../../db/schema'
import { listContributions } from '../../../services/contribution-service'
import { requireRole } from '../../../utils/rbac'
import { notDeleted } from '../../../utils/soft-delete'

// Lista de aportes: cada autenticado ve siempre los SUYOS; Admin/Propietario ven todos
// (mismo criterio de desglose individual que canSeeIndividualDebt — el Invitado no ve el
// grid de contribuciones de otros miembros).
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner', 'guest'])
  const canSeeAll = actor.role === 'admin' || actor.role === 'owner'

  // Lo que está en la papelera no se lista (fase 8): vive en /admin/trash.
  const rows = await listContributions(canSeeAll ? {} : { memberId: actor.id })

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
        }).from(bankTransactions).where(and(inArray(bankTransactions.id, transactionIds), notDeleted(bankTransactions)))
      : Promise.resolve([] as { id: string, date: string, amountCents: number, description: string }[])
  ])

  const nameById = new Map(userRows.map(u => [u.id, u.name]))
  // Un movimiento en la papelera no cuenta como vínculo vivo (RT8-2): se resuelve a null y
  // el aporte se muestra como «pendiente de depósito» hasta que el Admin lo restaure.
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
