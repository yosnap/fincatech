import { and, desc, gte, lte } from 'drizzle-orm'
import { db } from '../db/client'
import { expenses } from '../db/schema'
import { canSeeIndividualDebt, type SessionUser } from '../utils/rbac'
import type { ExportRow } from './export-formatters'

export type { ExportRow } from './export-formatters'
export { rowsToCsv, rowsToPdf } from './export-formatters'

// El Invitado ve el mismo libro contable que en /ledger: sin desglose de quién debe a
// quién (PRD §3), solo el gasto agregado.
export async function getExportRows(startDate: Date, endDate: Date, user: SessionUser): Promise<ExportRow[]> {
  const rows = await db.query.expenses.findMany({
    where: and(gte(expenses.createdAt, startDate), lte(expenses.createdAt, endDate)),
    orderBy: [desc(expenses.createdAt)]
  })

  if (!canSeeIndividualDebt(user)) {
    return rows.map(e => ({
      id: e.id,
      createdAt: e.createdAt,
      description: e.description,
      type: e.type,
      amountCents: e.amountCents,
      status: e.status
    }))
  }

  const allDebts = await db.query.debts.findMany()
  return rows.map(e => ({
    id: e.id,
    createdAt: e.createdAt,
    description: e.description,
    type: e.type,
    amountCents: e.amountCents,
    status: e.status,
    debts: allDebts
      .filter(d => d.expenseId === e.id)
      .map(d => ({ debtorId: d.debtorId, amountCents: d.amountCents, status: d.status }))
  }))
}
