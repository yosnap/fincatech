import { eq, inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { debts, expenses, users } from '../db/schema'
import { canSeeIndividualDebt, type SessionUser } from '../utils/rbac'

export interface DebtSummaryItem {
  id: string
  expenseId: string
  expenseDescription: string
  amountCents: number
  status: string
  counterpartyId: string
  counterpartyName: string
  createdAt: Date
  confirmedAt: Date | null
}

export interface DashboardSummary {
  // Deudas propias del usuario actual — siempre son "sus propios datos", nunca desglose
  // de terceros, así que no aplica la restricción de RBAC de canSeeIndividualDebt.
  pendingAsDebtor: DebtSummaryItem[]
  pendingAsCreditor: DebtSummaryItem[]
  // Confirmadas: permiten calcular "cuánto he pagado/me han pagado" filtrando por
  // confirmedAt en el cliente (semana/mes/histórico) sin re-consultar el servidor.
  paidAsDebtor: DebtSummaryItem[]
  paidAsCreditor: DebtSummaryItem[]
  // Agregados del fondo común: solo totales por periodo, visibles para todos los roles.
  aggregateTotals: { monthCents: number, quarterCents: number, allTimeCents: number }
}

export async function getDashboardSummary(user: SessionUser): Promise<DashboardSummary> {
  const [myDebtsAsDebtor, myDebtsAsCreditor] = await Promise.all([
    db.query.debts.findMany({ where: eq(debts.debtorId, user.id) }),
    db.query.debts.findMany({ where: eq(debts.creditorId, user.id) })
  ])

  const relevantExpenseIds = [...new Set([...myDebtsAsDebtor, ...myDebtsAsCreditor].map(d => d.expenseId))]
  const relevantExpenses = relevantExpenseIds.length
    ? await db.query.expenses.findMany({ where: inArray(expenses.id, relevantExpenseIds) })
    : []
  const expenseMap = new Map(relevantExpenses.map(e => [e.id, e]))

  const counterpartyIds = [...new Set([
    ...myDebtsAsDebtor.map(d => d.creditorId),
    ...myDebtsAsCreditor.map(d => d.debtorId)
  ])]
  const counterpartyUsers = counterpartyIds.length
    ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, counterpartyIds))
    : []
  const nameMap = new Map(counterpartyUsers.map(u => [u.id, u.name]))

  function toSummary(debt: typeof myDebtsAsDebtor[number], counterpartyId: string): DebtSummaryItem {
    return {
      id: debt.id,
      expenseId: debt.expenseId,
      expenseDescription: expenseMap.get(debt.expenseId)?.description ?? '',
      amountCents: debt.amountCents,
      status: debt.status,
      counterpartyId,
      counterpartyName: nameMap.get(counterpartyId) ?? counterpartyId,
      createdAt: debt.createdAt,
      confirmedAt: debt.confirmedAt
    }
  }

  const pendingAsDebtor = myDebtsAsDebtor
    .filter(d => d.status !== 'confirmed')
    .map(d => toSummary(d, d.creditorId))
  const pendingAsCreditor = myDebtsAsCreditor
    .filter(d => d.status !== 'confirmed')
    .map(d => toSummary(d, d.debtorId))
  const paidAsDebtor = myDebtsAsDebtor
    .filter(d => d.status === 'confirmed')
    .map(d => toSummary(d, d.creditorId))
  const paidAsCreditor = myDebtsAsCreditor
    .filter(d => d.status === 'confirmed')
    .map(d => toSummary(d, d.debtorId))

  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const quarterStart = new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1))
  const allExpenses = await db.query.expenses.findMany()
  const aggregateTotals = {
    monthCents: allExpenses.filter(e => e.createdAt >= monthStart).reduce((sum, e) => sum + e.amountCents, 0),
    quarterCents: allExpenses.filter(e => e.createdAt >= quarterStart).reduce((sum, e) => sum + e.amountCents, 0),
    allTimeCents: allExpenses.reduce((sum, e) => sum + e.amountCents, 0)
  }

  return { pendingAsDebtor, pendingAsCreditor, paidAsDebtor, paidAsCreditor, aggregateTotals }
}

export interface MonthlyTotal { monthKey: string, label: string, totalCents: number }
export interface ExpenseTypeBreakdown { type: string, label: string, totalCents: number, count: number }
export interface OwnerBalance { userId: string, name: string, netCents: number }

export interface ExpenseStatistics {
  monthly: MonthlyTotal[]
  byType: ExpenseTypeBreakdown[]
  // null para el Invitado: el saldo por propietario es desglose de deuda individual
  // (mismo criterio que canSeeIndividualDebt en el resto de la app).
  byOwner: OwnerBalance[] | null
}

const EXPENSE_TYPE_LABELS: Record<string, string> = {
  manual: 'Gasto manual',
  bank_receipt: 'Recibo bancario',
  derrama: 'Derrama'
}

const MONTH_LABELS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

export async function getExpenseStatistics(user: SessionUser): Promise<ExpenseStatistics> {
  const allExpenses = await db.query.expenses.findMany()

  const now = new Date()
  const months = Array.from({ length: 6 }, (_, i) => {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (5 - i), 1))
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))
    return { start, end, key: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`, label: `${MONTH_LABELS[start.getUTCMonth()]} ${start.getUTCFullYear()}` }
  })
  const monthly = months.map(m => ({
    monthKey: m.key,
    label: m.label,
    totalCents: allExpenses.filter(e => e.createdAt >= m.start && e.createdAt < m.end).reduce((sum, e) => sum + e.amountCents, 0)
  }))

  const byTypeMap = new Map<string, { totalCents: number, count: number }>()
  for (const expense of allExpenses) {
    const entry = byTypeMap.get(expense.type) ?? { totalCents: 0, count: 0 }
    entry.totalCents += expense.amountCents
    entry.count += 1
    byTypeMap.set(expense.type, entry)
  }
  const byType = [...byTypeMap.entries()].map(([type, v]) => ({
    type,
    label: EXPENSE_TYPE_LABELS[type] ?? type,
    totalCents: v.totalCents,
    count: v.count
  }))

  let byOwner: OwnerBalance[] | null = null
  if (canSeeIndividualDebt(user)) {
    const allDebts = await db.query.debts.findMany()
    const allUsers = await db.select({ id: users.id, name: users.name }).from(users)
    const netByUser = new Map<string, number>(allUsers.map(u => [u.id, 0]))
    // Solo deuda viva (no confirmada) — un saldo liquidado no debe seguir apareciendo aquí.
    for (const debt of allDebts.filter(d => d.status !== 'confirmed')) {
      netByUser.set(debt.creditorId, (netByUser.get(debt.creditorId) ?? 0) + debt.amountCents)
      netByUser.set(debt.debtorId, (netByUser.get(debt.debtorId) ?? 0) - debt.amountCents)
    }
    byOwner = allUsers
      .map(u => ({ userId: u.id, name: u.name, netCents: netByUser.get(u.id) ?? 0 }))
      .filter(o => o.netCents !== 0)
      .sort((a, b) => b.netCents - a.netCents)
  }

  return { monthly, byType, byOwner }
}
