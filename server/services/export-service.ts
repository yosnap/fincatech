import { and, desc, gte, lte } from 'drizzle-orm'
import { db } from '../db/client'
import { expenses } from '../db/schema'
import { canSeeIndividualDebt, type SessionUser } from '../utils/rbac'
import { listLiveDebts, notDeleted } from '../utils/soft-delete'
import type { ExportRow } from './export-formatters'

export type { ExportRow } from './export-formatters'
export { rowsToCsv, rowsToPdf } from './export-formatters'

// El Invitado ve el mismo libro contable que en /ledger: sin desglose de quién debe a
// quién (PRD §3), solo el gasto agregado.
export async function getExportRows(startDate: string, endDate: string, user: SessionUser): Promise<ExportRow[]> {
  // El rango se compara como texto 'YYYY-MM-DD' contra `expense_date` (columna `date` de
  // Drizzle en modo string): sin conversiones de fecha ni sustos de zona horaria.
  // La exportación fiscal no incluye gastos en la papelera (fase 8): no son gasto real.
  const rows = await db.query.expenses.findMany({
    where: and(notDeleted(expenses), gte(expenses.expenseDate, startDate), lte(expenses.expenseDate, endDate)),
    orderBy: [desc(expenses.expenseDate), desc(expenses.createdAt)]
  })

  if (!canSeeIndividualDebt(user)) {
    return rows.map(e => ({
      id: e.id,
      expenseDate: e.expenseDate,
      description: e.description,
      type: e.type,
      amountCents: e.amountCents,
      status: e.status
    }))
  }

  const allDebts = await listLiveDebts()
  return rows.map(e => ({
    id: e.id,
    expenseDate: e.expenseDate,
    description: e.description,
    type: e.type,
    amountCents: e.amountCents,
    status: e.status,
    debts: allDebts
      .filter(d => d.expenseId === e.id)
      .map(d => ({ debtorId: d.debtorId, amountCents: d.amountCents, status: d.status }))
  }))
}
