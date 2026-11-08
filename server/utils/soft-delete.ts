import { and, eq, isNull, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { db } from '../db/client'
import { debts, expenses } from '../db/schema'

// ---- Papelera (borrado lógico, fase 8) ----
//
// Movimientos, aportes y gastos no se borran: se marcan con `deletedAt`/`deletedBy` y todas
// las lecturas los excluyen. Las DEUDAS no tienen columna propia: heredan el estado de su
// gasto, porque una deuda de un gasto en la papelera no debe aparecer en la liquidación.
//
// Regla de oro: cualquier consulta nueva sobre `bank_transactions`, `contributions`,
// `expenses` o `debts` debe pasar por `notDeleted()` / `liveDebts()` / `listLiveExpenses()`.
// Si no, el elemento reaparece en saldos, grids o liquidaciones.

interface SoftDeletableTable {
  deletedAt: AnyPgColumn
}

export function notDeleted<T extends SoftDeletableTable>(table: T): SQL {
  return isNull(table.deletedAt)
}

export function isTrashed(row: { deletedAt: Date | null }): boolean {
  return row.deletedAt !== null
}

// Guard de mutación (RT8-5): toda operación que modifique una fila comprueba su estado
// DENTRO de la transacción, bajo el FOR UPDATE que ya toma el servicio. Así un borrado
// concurrente no puede colarse entre el check y el update.
export function assertNotTrashed(row: { deletedAt: Date | null }, message: string): void {
  if (isTrashed(row)) {
    throw createError({ statusCode: 409, statusMessage: message })
  }
}

export type DebtRow = typeof debts.$inferSelect
export type ExpenseRow = typeof expenses.$inferSelect

// Deudas cuyo gasto sigue vivo. `where` se combina con el filtro de papelera (nunca lo
// sustituye): innerJoin con expenses para descartar las de gastos en la papelera.
export async function listLiveDebts(where?: SQL): Promise<DebtRow[]> {
  const rows = await db
    .select({ debt: debts })
    .from(debts)
    .innerJoin(expenses, eq(debts.expenseId, expenses.id))
    .where(where ? and(notDeleted(expenses), where) : notDeleted(expenses))
  return rows.map(row => row.debt)
}

// Deudas de un gasto concreto, SOLO si el gasto sigue vivo (mismo criterio que la
// liquidación: las deudas de un gasto en la papelera no existen para el usuario).
export async function listLiveDebtsByExpense(expenseId: string): Promise<DebtRow[]> {
  return listLiveDebts(eq(debts.expenseId, expenseId))
}

// Gastos vivos, con el filtro de papelera ya aplicado. `where` se combina, no se sustituye.
export async function listLiveExpenses(where?: SQL): Promise<ExpenseRow[]> {
  return db
    .select()
    .from(expenses)
    .where(where ? and(notDeleted(expenses), where) : notDeleted(expenses))
}
