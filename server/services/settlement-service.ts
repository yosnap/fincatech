import { eq, or } from 'drizzle-orm'
import { db } from '../db/client'
import { bankTransactions, contributions, debts, users } from '../db/schema'
import {
  computeFondoComun,
  type FondoComunMember
} from './bank-core'
import { getActiveMembers } from './bank-service'
import { canSeeIndividualDebt, type SessionUser } from '../utils/rbac'
import { computeSettlement, type Settlement } from './settlement-core'

export type SettlementWithFondoComun = Settlement & {
  // Saldo con el fondo común por miembro (aportado − salidas/N). Sección additive de la
  // liquidación: no toca las deudas pairwise. null cuando el rol no puede ver desglose
  // económico de terceros (Invitado, mismo criterio que totalSpentCents).
  fondoComun: FondoComunMember[] | null
}

// Liquidación de cuentas del usuario actual: para cada contraparte con deuda viva compensa
// lo que me debe (su parte de mis recibos) con lo que le debo (mi parte de los suyos) y
// devuelve la diferencia final por persona. El total global de recibos pagados por cada
// persona es solo contexto y se oculta al Invitado (mismo criterio que canSeeIndividualDebt).
export async function getSettlement(user: SessionUser): Promise<SettlementWithFondoComun> {
  const [myDebts, allExpenses, allUsers] = await Promise.all([
    db.select().from(debts).where(or(eq(debts.debtorId, user.id), eq(debts.creditorId, user.id))),
    db.query.expenses.findMany(),
    db.select({ id: users.id, name: users.name }).from(users)
  ])

  const settlement = computeSettlement(user.id, myDebts, allExpenses, allUsers, canSeeIndividualDebt(user))

  // Fondo común (sección nueva): solo se consulta si el rol puede verlo — el Invitado no
  // dispara las consultas de contribuciones/movimientos.
  if (!canSeeIndividualDebt(user)) {
    return { ...settlement, fondoComun: null }
  }

  const [allContributions, allTransactions, activeMembers] = await Promise.all([
    db.select().from(contributions),
    db.select().from(bankTransactions),
    getActiveMembers()
  ])

  return {
    ...settlement,
    fondoComun: computeFondoComun(allContributions, allTransactions, activeMembers)
  }
}
