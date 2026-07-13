import { sql } from 'drizzle-orm'
import { boolean, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { proposals } from './governance'
import { users } from './users'

// Importes SIEMPRE en céntimos enteros (nunca float) — ver server/services/debt-splitter.ts.
export const expenses = pgTable('expenses', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdBy: text('created_by').notNull().references(() => users.id),
  amountCents: integer('amount_cents').notNull(),
  description: text('description').notNull(),
  // 'manual' | 'bank_receipt' — validado en la capa de aplicación.
  type: text('type').notNull(),
  // false => el gasto se marca visualmente como "Sin Comprobante" (PRD §4.1).
  hasProof: boolean('has_proof').notNull().default(true),
  // 'pending' | 'partial' | 'settled' — derivado del estado de las debts, cacheado aquí
  // para listados baratos; se recalcula en expense-service tras cada confirmReceipt.
  status: text('status').notNull().default('pending'),
  // Snapshot congelado en el momento de creación: [{ userId, amountCents }] para TODOS los
  // participantes (incluido el pagador). Nunca se recalcula si cambia N después.
  participantSnapshot: jsonb('participant_snapshot').notNull(),
  // Impuestos (IVA) del ticket, ya incluidos en amountCents (no se suma aparte) — informativo,
  // extraído por OCR o introducido a mano. Null si no aplica/no se conoce.
  taxCents: integer('tax_cents'),
  // Solo se rellenan cuando el gasto viene de OCR (Fase 4) — null en gastos manuales.
  ocrConfidence: real('ocr_confidence'),
  ocrCostUsd: real('ocr_cost_usd'),
  // No nulo solo para type='derrama' (Fase 7) — guard idempotente de executeApprovedProposal:
  // una propuesta aprobada nunca genera dos derramas.
  originProposalId: uuid('origin_proposal_id').references(() => proposals.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, table => [
  // Red de seguridad a nivel de esquema para la idempotencia de la derrama: aunque el guard
  // de aplicación (executeApprovedProposalCore) tenga un bug o se inserte por otra vía, la
  // DB nunca permite dos expenses para la misma propuesta.
  uniqueIndex('expenses_origin_proposal_unique').on(table.originProposalId).where(sql`${table.originProposalId} is not null`)
])

export const debts = pgTable('debts', {
  id: uuid('id').primaryKey().defaultRandom(),
  expenseId: uuid('expense_id').notNull().references(() => expenses.id, { onDelete: 'cascade' }),
  debtorId: text('debtor_id').notNull().references(() => users.id),
  creditorId: text('creditor_id').notNull().references(() => users.id),
  amountCents: integer('amount_cents').notNull(),
  // 'pending' | 'pending_confirmation' | 'confirmed' — validado en la capa de aplicación.
  status: text('status').notNull().default('pending'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  confirmedBy: text('confirmed_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
})

// Polimórfica: un comprobante puede colgar de un expense (ticket original) o de una debt
// (justificante de transferencia al marcar una cuota como pagada).
export const paymentProofs = pgTable('payment_proofs', {
  id: uuid('id').primaryKey().defaultRandom(),
  objectName: text('object_name').notNull(),
  contentType: text('content_type').notNull(),
  uploadedBy: text('uploaded_by').notNull().references(() => users.id),
  // 'expense' | 'debt' — validado en la capa de aplicación.
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})
