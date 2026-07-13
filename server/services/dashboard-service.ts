import { eq, inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { debts, expenses, users } from '../db/schema'
import type { SessionUser } from '../utils/rbac'

export interface DebtSummaryItem {
  id: string
  expenseId: string
  expenseDescription: string
  amountCents: number
  status: string
  counterpartyId: string
  counterpartyName: string
  createdAt: Date
}

export interface HistoryEntry {
  monthKey: string
  totalCents: number
  count: number
}

export interface DashboardSummary {
  // Deudas propias del usuario actual — siempre son "sus propios datos", nunca desglose
  // de terceros, así que no aplica la restricción de RBAC de canSeeIndividualDebt.
  pendingAsDebtor: DebtSummaryItem[]
  pendingAsCreditor: DebtSummaryItem[]
  paymentHistory: HistoryEntry[]
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
      createdAt: debt.createdAt
    }
  }

  const pendingAsDebtor = myDebtsAsDebtor
    .filter(d => d.status !== 'confirmed')
    .map(d => toSummary(d, d.creditorId))
  const pendingAsCreditor = myDebtsAsCreditor
    .filter(d => d.status !== 'confirmed')
    .map(d => toSummary(d, d.debtorId))

  const historyMap = new Map<string, { totalCents: number, count: number }>()
  for (const debt of [...myDebtsAsDebtor, ...myDebtsAsCreditor]) {
    if (debt.status !== 'confirmed' || !debt.confirmedAt) continue
    const monthKey = debt.confirmedAt.toISOString().slice(0, 7)
    const entry = historyMap.get(monthKey) ?? { totalCents: 0, count: 0 }
    entry.totalCents += debt.amountCents
    entry.count += 1
    historyMap.set(monthKey, entry)
  }
  const paymentHistory = [...historyMap.entries()]
    .map(([monthKey, v]) => ({ monthKey, ...v }))
    .sort((a, b) => b.monthKey.localeCompare(a.monthKey))

  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const quarterStart = new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1))
  const allExpenses = await db.query.expenses.findMany()
  const aggregateTotals = {
    monthCents: allExpenses.filter(e => e.createdAt >= monthStart).reduce((sum, e) => sum + e.amountCents, 0),
    quarterCents: allExpenses.filter(e => e.createdAt >= quarterStart).reduce((sum, e) => sum + e.amountCents, 0),
    allTimeCents: allExpenses.reduce((sum, e) => sum + e.amountCents, 0)
  }

  return { pendingAsDebtor, pendingAsCreditor, paymentHistory, aggregateTotals }
}
