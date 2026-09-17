import { sql } from 'drizzle-orm'
import { boolean, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { users } from './users'

// Cuenta bancaria de la copropiedad: espeja los ingresos y salidas reales del banco, tanto
// anteriores como posteriores a la compra del inmueble. El saldo NUNCA se guarda: se calcula
// sumando movimientos (server/services/bank-core.ts). Importes SIEMPRE en céntimos enteros.
export const bankTransactions = pgTable('bank_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Fecha valor del movimiento (no la de registro).
  date: date('date').notNull(),
  // 'deposit' | 'withdrawal' — validado en la capa de aplicación.
  direction: text('direction').notNull(),
  amountCents: integer('amount_cents').notNull(),
  description: text('description').notNull(),
  // Solo depósitos ajenos a miembros: 'hacienda' | 'ayuntamiento' | 'impuestos' | 'iva' | 'otro'.
  // Null en el resto de movimientos. Los externos NO se acreditan a ningún miembro en el
  // fondo común (ver computeFondoComun).
  category: text('category'),
  // Desnormalizado para listados baratos; la fila real vive en payment_proofs (polimórfica).
  hasProof: boolean('has_proof').notNull().default(false),
  registeredBy: text('registered_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => [
  index('bank_transactions_date_idx').on(table.date)
])

// Aportaciones de los miembros a la copropiedad: aportes pre-compra (histórico), cuota
// mensual fija y aportes extraordinarios. Un aporte en efectivo queda "pendiente de
// depósito" hasta que se vincula (bankTransactionId) al ingreso bancario real.
export const contributions = pgTable('contributions', {
  id: uuid('id').primaryKey().defaultRandom(),
  memberId: text('member_id').notNull().references(() => users.id),
  amountCents: integer('amount_cents').notNull(),
  // 'pre_purchase' | 'quota' | 'extraordinary' — validado en la capa de aplicación.
  type: text('type').notNull(),
  // 'YYYY-MM'; null para pre_purchase y extraordinary. Una cuota parcial de un mes NO es
  // cuota: se registra como extraordinary (decisión de producto).
  period: text('period'),
  // 'cash' | 'transfer' — transfer crea automáticamente el ingreso bancario vinculado.
  method: text('method').notNull(),
  // Fecha del aporte (cuándo el miembro entregó el dinero), no la del depósito en banco.
  date: date('date').notNull(),
  // FK lógica a bank_transactions sin constraint dura (patrón polimórfico del repo): al
  // borrar un movimiento, el servicio desvincula los aportes que lo referencian.
  bankTransactionId: uuid('bank_transaction_id'),
  // Quién lo registró: el propio miembro (opción A) o el admin por otro (opción B).
  registeredBy: text('registered_by').notNull().references(() => users.id),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, table => [
  // Una sola cuota por miembro y mes. El adelanto multi-mes crea N filas (una por mes);
  // pre_purchase/extraordinary (period null) no colisionan porque PostgreSQL trata los
  // NULL como distintos en índices únicos.
  uniqueIndex('contributions_quota_unique').on(table.memberId, table.period).where(sql`${table.type} = 'quota'`),
  index('contributions_member_idx').on(table.memberId),
  index('contributions_period_idx').on(table.period)
])

// Configuración financiera global de la copropiedad: una única fila con id = 'global'.
// No existe tabla `property` (non-goal del plan): esto cubre solo los parámetros financieros.
export const financeSettings = pgTable('finance_settings', {
  id: text('id').primaryKey(),
  // Fecha de compra del inmueble: corta el histórico pre/post compra (estricto <).
  purchaseDate: date('purchase_date'),
  quotaAmountCents: integer('quota_amount_cents'),
  // 'YYYY-MM' del primer mes con cuota obligatoria.
  quotaStartMonth: text('quota_start_month'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
})
