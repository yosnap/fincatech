import { inArray } from 'drizzle-orm'
import { db } from '../../db/client'
import { bankTransactions, contributions, users } from '../../db/schema'
import {
  computeBalances,
  computeFondoComun,
  computeReconciliation
} from '../../services/bank-core'
import { getActiveMembers, getSettings } from '../../services/bank-service'
import { canSeeIndividualDebt, requireRole } from '../../utils/rbac'

// Resumen de conciliación: saldo actual, saldo pre-compra, efectivo pendiente de depósito,
// ingresos sin origen y (solo Admin/Propietario) el fondo común por miembro. El Invitado
// recibe fondoComun = null y la LISTA de efectivo pendiente vacía (desglose individual,
// mismo criterio que canSeeIndividualDebt): solo ve el agregado cashPendingCents.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner', 'guest'])
  const canSeeIndividual = canSeeIndividualDebt(actor)

  const [transactions, allContributions, activeMembers, settings] = await Promise.all([
    db.select().from(bankTransactions),
    db.select().from(contributions),
    getActiveMembers(),
    getSettings()
  ])

  const balances = computeBalances(transactions, settings.purchaseDate)
  const reconciliation = computeReconciliation(transactions, allContributions)

  // Nombres de los miembros con efectivo pendiente para las alertas del resumen (solo si
  // el rol puede ver desglose individual).
  const pendingMemberIds = [...new Set(reconciliation.cashPending.map(c => c.memberId))]
  const pendingMembers = canSeeIndividual && pendingMemberIds.length > 0
    ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, pendingMemberIds))
    : []
  const nameById = new Map(pendingMembers.map(u => [u.id, u.name]))

  const fondoComun = canSeeIndividual
    ? computeFondoComun(allContributions, transactions, activeMembers)
    : null

  return {
    ...balances,
    cashPendingCents: reconciliation.cashPendingCents,
    cashPending: canSeeIndividual
      ? reconciliation.cashPending.map(c => ({
          id: c.id,
          memberId: c.memberId,
          memberName: nameById.get(c.memberId) ?? c.memberId,
          amountCents: c.amountCents,
          date: c.date
        }))
      : [],
    unmatchedDeposits: reconciliation.unmatchedDeposits.map(t => ({
      id: t.id,
      date: t.date,
      amountCents: t.amountCents,
      description: t.description
    })),
    fondoComun
  }
})
