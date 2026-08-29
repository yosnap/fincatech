import { eq, or } from 'drizzle-orm'
import { db } from '../db/client'
import { debts, users } from '../db/schema'
import { canSeeIndividualDebt, type SessionUser } from '../utils/rbac'
import { computeSettlement, type Settlement } from './settlement-core'

// Liquidación de cuentas del usuario actual: para cada contraparte con deuda viva compensa
// lo que me debe (su parte de mis recibos) con lo que le debo (mi parte de los suyos) y
// devuelve la diferencia final por persona. El total global de recibos pagados por cada
// persona es solo contexto y se oculta al Invitado (mismo criterio que canSeeIndividualDebt).
export async function getSettlement(user: SessionUser): Promise<Settlement> {
  const [myDebts, allExpenses, allUsers] = await Promise.all([
    db.select().from(debts).where(or(eq(debts.debtorId, user.id), eq(debts.creditorId, user.id))),
    db.query.expenses.findMany(),
    db.select({ id: users.id, name: users.name }).from(users)
  ])
  return computeSettlement(user.id, myDebts, allExpenses, allUsers, canSeeIndividualDebt(user))
}
