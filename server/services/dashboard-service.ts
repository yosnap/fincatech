import { eq, inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { debts, expenses, users } from '../db/schema'
import { canSeeIndividualDebt, type SessionUser } from '../utils/rbac'
import { todayInMadrid } from '../utils/madrid-date'
import { listLiveDebts, listLiveExpenses } from '../utils/soft-delete'
import { addMonths } from './bank-core'

export interface DebtSummaryItem {
  id: string
  expenseId: string
  expenseDescription: string
  amountCents: number
  status: string
  counterpartyId: string
  counterpartyName: string
  // Fecha del gasto ('YYYY-MM-DD'): es la que ordena y fecha la deuda en el panel (RT-12).
  expenseDate: string
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
  // El panel solo muestra deudas de gastos vivos (fase 8): lo que está en la papelera no es
  // una deuda real ni suma en los totales del fondo.
  const [myDebtsAsDebtor, myDebtsAsCreditor] = await Promise.all([
    listLiveDebts(eq(debts.debtorId, user.id)),
    listLiveDebts(eq(debts.creditorId, user.id))
  ])

  const relevantExpenseIds = [...new Set([...myDebtsAsDebtor, ...myDebtsAsCreditor].map(d => d.expenseId))]
  const relevantExpenses = relevantExpenseIds.length
    ? await listLiveExpenses(inArray(expenses.id, relevantExpenseIds))
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
      expenseDate: expenseMap.get(debt.expenseId)?.expenseDate ?? '',
      createdAt: debt.createdAt,
      confirmedAt: debt.confirmedAt
    }
  }

  // Lo más reciente primero por fecha del gasto (la de alta solo desempata).
  const byExpenseDateDesc = (a: DebtSummaryItem, b: DebtSummaryItem) =>
    b.expenseDate.localeCompare(a.expenseDate) || b.createdAt.getTime() - a.createdAt.getTime()

  const pendingAsDebtor = myDebtsAsDebtor
    .filter(d => d.status !== 'confirmed')
    .map(d => toSummary(d, d.creditorId))
    .sort(byExpenseDateDesc)
  const pendingAsCreditor = myDebtsAsCreditor
    .filter(d => d.status !== 'confirmed')
    .map(d => toSummary(d, d.debtorId))
    .sort(byExpenseDateDesc)
  const paidAsDebtor = myDebtsAsDebtor
    .filter(d => d.status === 'confirmed')
    .map(d => toSummary(d, d.creditorId))
    .sort(byExpenseDateDesc)
  const paidAsCreditor = myDebtsAsCreditor
    .filter(d => d.status === 'confirmed')
    .map(d => toSummary(d, d.debtorId))
    .sort(byExpenseDateDesc)

  // Los agregados se calculan por la FECHA DEL GASTO como texto 'YYYY-MM-DD' (RT-12): sin
  // conversiones de fecha ni desplazamientos de zona horaria.
  const today = todayInMadrid()
  const currentMonth = today.slice(0, 7)
  const [currentYear, currentMonthNumber] = today.split('-').map(Number)
  const quarterStart = `${currentYear}-${String(Math.floor((currentMonthNumber! - 1) / 3) * 3 + 1).padStart(2, '0')}-01`
  const allExpenses = await listLiveExpenses()
  const aggregateTotals = {
    monthCents: allExpenses
      .filter(e => e.expenseDate.startsWith(currentMonth))
      .reduce((sum, e) => sum + e.amountCents, 0),
    quarterCents: allExpenses
      .filter(e => e.expenseDate >= quarterStart)
      .reduce((sum, e) => sum + e.amountCents, 0),
    allTimeCents: allExpenses.reduce((sum, e) => sum + e.amountCents, 0)
  }

  return { pendingAsDebtor, pendingAsCreditor, paidAsDebtor, paidAsCreditor, aggregateTotals }
}

export interface MonthlyTotal { monthKey: string, label: string, totalCents: number }
export interface ExpenseTypeBreakdown { type: string, label: string, totalCents: number, count: number }
export interface OwnerBalance { userId: string, name: string, netCents: number }
// Total histórico de recibos subidos por cada propietario (createdBy), como contexto
// global de cuánto ha gastado cada uno — null para el Invitado (canSeeIndividualDebt).
export interface CreatorTotal { userId: string, name: string, totalCents: number, count: number }

export interface ExpenseStatistics {
  monthly: MonthlyTotal[]
  byType: ExpenseTypeBreakdown[]
  // null para el Invitado: el saldo por propietario es desglose de deuda individual
  // (mismo criterio que canSeeIndividualDebt en el resto de la app).
  byOwner: OwnerBalance[] | null
  // null para el Invitado, igual que byOwner.
  byCreator: CreatorTotal[] | null
}

const EXPENSE_TYPE_LABELS: Record<string, string> = {
  manual: 'Gasto manual',
  bank_receipt: 'Recibo bancario',
  derrama: 'Derrama'
}

const MONTH_LABELS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

export async function getExpenseStatistics(user: SessionUser): Promise<ExpenseStatistics> {
  const allExpenses = await listLiveExpenses()

  // 12 meses en vez de 6: con un año a la vista se aprecia la estacionalidad de la finca
  // (verano, derramas anuales…) que medio año esconde. Buckets por mes de la FECHA DEL GASTO.
  const currentMonth = todayInMadrid().slice(0, 7)
  const months = Array.from({ length: 12 }, (_, i) => {
    const key = addMonths(currentMonth, i - 11)
    const [year, monthNumber] = key.split('-').map(Number)
    return { key, label: `${MONTH_LABELS[monthNumber! - 1]} ${year}` }
  })
  const monthly = months.map(m => ({
    monthKey: m.key,
    label: m.label,
    totalCents: allExpenses
      .filter(e => e.expenseDate.startsWith(m.key))
      .reduce((sum, e) => sum + e.amountCents, 0)
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
  let byCreator: CreatorTotal[] | null = null
  if (canSeeIndividualDebt(user)) {
    const allDebts = await listLiveDebts()
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

    const spentByCreator = new Map<string, { totalCents: number, count: number }>()
    for (const expense of allExpenses) {
      const entry = spentByCreator.get(expense.createdBy) ?? { totalCents: 0, count: 0 }
      entry.totalCents += expense.amountCents
      entry.count += 1
      spentByCreator.set(expense.createdBy, entry)
    }
    byCreator = allUsers
      .filter(u => spentByCreator.has(u.id))
      .map(u => ({ userId: u.id, name: u.name, ...spentByCreator.get(u.id)! }))
      .sort((a, b) => b.totalCents - a.totalCents)
  }

  return { monthly, byType, byOwner, byCreator }
}
