import { and, asc, eq, inArray } from 'drizzle-orm'
import { db, type TxExecutor } from '../db/client'
import { bankTransactions, contributions, financeSettings, paymentProofs, users } from '../db/schema'
import { writeAuditLog } from '../utils/audit'
import { assertNotTrashed, notDeleted } from '../utils/soft-delete'
import { assertNoOtherChargeForMonth } from './mortgage-service'
import { deleteFile } from './storage'

export const BANK_DIRECTIONS = ['deposit', 'withdrawal'] as const
export type BankDirection = (typeof BANK_DIRECTIONS)[number]

export const EXTERNAL_CATEGORIES = ['hacienda', 'ayuntamiento', 'impuestos', 'iva', 'otro'] as const
export type ExternalCategory = (typeof EXTERNAL_CATEGORIES)[number]

export interface ActiveMember {
  id: string
  name: string
  role: string
}

// Miembros activos = admin/owner no dados de baja (mismo criterio que el selector de
// participantes de gastos, server/api/expenses/participants.get.ts). Es la N de la fórmula
// del fondo común y las filas del grid de cuotas.
export async function getActiveMembers(): Promise<ActiveMember[]> {
  return db.select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(and(eq(users.banned, false), inArray(users.role, ['admin', 'owner'])))
}

interface CreateTransactionInput {
  actorId: string
  date: string
  direction: BankDirection
  amountCents: number
  description: string
  category: ExternalCategory | null
  // Justificante YA subido a MinIO antes de llamar aquí — igual que createExpense, nunca
  // se sube el archivo después de escribir en DB.
  proof?: { objectName: string, contentType: string }
}

export async function createTransaction(input: CreateTransactionInput) {
  return db.transaction(async (tx) => {
    const [transaction] = await tx.insert(bankTransactions).values({
      date: input.date,
      direction: input.direction,
      amountCents: input.amountCents,
      description: input.description,
      category: input.category,
      hasProof: !!input.proof,
      registeredBy: input.actorId
    }).returning()
    if (!transaction) {
      throw createError({ statusCode: 500, statusMessage: 'No se pudo crear el movimiento' })
    }

    if (input.proof) {
      await tx.insert(paymentProofs).values({
        objectName: input.proof.objectName,
        contentType: input.proof.contentType,
        uploadedBy: input.actorId,
        entityType: 'bank_transaction',
        entityId: transaction.id
      })
    }

    await writeAuditLog({
      actorId: input.actorId,
      action: 'bank_transaction_created',
      entityType: 'bank_transaction',
      entityId: transaction.id,
      metadata: { direction: input.direction, amountCents: input.amountCents, category: input.category }
    }, tx)

    return transaction
  })
}

interface UpdateTransactionInput {
  transactionId: string
  actorId: string
  date: string
  direction: BankDirection
  amountCents: number
  description: string
  category: ExternalCategory | null
}

// Edición de movimiento (solo Admin, el tesorero corrige errores de registro: fecha mal
// puesta, importe, descripción…). El justificante no se toca aquí (se adjunta/cambia desde
// la lista). Guardas de coherencia con la conciliación: un movimiento con aportes
// vinculados debe seguir siendo un ingreso sin categoría externa.
export async function updateTransaction(input: UpdateTransactionInput) {
  return db.transaction(async (tx) => {
    const [transaction] = await tx.select().from(bankTransactions)
      .where(eq(bankTransactions.id, input.transactionId)).for('update')
    if (!transaction) {
      throw createError({ statusCode: 404, statusMessage: 'Movimiento no encontrado' })
    }
    assertNotTrashed(transaction, 'El movimiento está en la papelera: restáuralo antes de editarlo')

    // Solo aportes vivos: un aporte en la papelera no condiciona la coherencia del
    // movimiento, porque tampoco cuenta en el saldo ni en la conciliación.
    const linked = await tx.select({ id: contributions.id })
      .from(contributions)
      .where(and(eq(contributions.bankTransactionId, transaction.id), notDeleted(contributions)))
    if (linked.length > 0) {
      if (input.direction !== 'deposit') {
        throw createError({ statusCode: 409, statusMessage: 'El movimiento tiene aportes vinculados y debe seguir siendo un ingreso' })
      }
      if (input.category) {
        throw createError({ statusCode: 409, statusMessage: 'El movimiento tiene aportes vinculados y no puede marcarse como ingreso externo' })
      }
    }

    // Editar un cargo automático de la hipoteca lo convierte en manual (RT-10): el relleno y
    // el cron nunca vuelven a tocarlo ni lo recrean si se borra. El servicio lo devuelve para
    // que la UI avise.
    const mortgagePeriodCleared = transaction.mortgagePeriod

    const [updated] = await tx.update(bankTransactions)
      .set({
        date: input.date,
        direction: input.direction,
        amountCents: input.amountCents,
        description: input.description,
        category: input.category,
        hasProof: transaction.hasProof,
        registeredBy: transaction.registeredBy,
        mortgagePeriod: null
      })
      .where(eq(bankTransactions.id, transaction.id))
      .returning()

    await writeAuditLog({
      actorId: input.actorId,
      action: 'bank_transaction_updated',
      entityType: 'bank_transaction',
      entityId: transaction.id,
      metadata: {
        previous: { date: transaction.date, direction: transaction.direction, amountCents: transaction.amountCents, description: transaction.description, category: transaction.category },
        next: { date: input.date, direction: input.direction, amountCents: input.amountCents, description: input.description, category: input.category },
        mortgagePeriodCleared
      }
    }, tx)

    return { transaction: updated!, mortgagePeriodCleared }
  })
}

interface AttachProofInput {
  transactionId: string
  actorId: string
  proof: { objectName: string, contentType: string }
}

// Adjuntar el justificante DESPUÉS de crear el movimiento (hasProof false → true).
export async function attachTransactionProof(input: AttachProofInput) {
  return db.transaction(async (tx) => {
    // FOR UPDATE + re-check del 409 DENTRO de la tx: el check previo del endpoint es solo
    // fast-path; sin esto, dos adjuntos concurrentes insertarían dos filas en
    // payment_proofs y voltearían hasProof dos veces.
    const [transaction] = await tx.select().from(bankTransactions)
      .where(eq(bankTransactions.id, input.transactionId)).for('update')
    if (!transaction) {
      throw createError({ statusCode: 404, statusMessage: 'Movimiento no encontrado' })
    }
    assertNotTrashed(transaction, 'El movimiento está en la papelera: restáuralo antes de adjuntar el justificante')
    if (transaction.hasProof) {
      throw createError({ statusCode: 409, statusMessage: 'El movimiento ya tiene justificante' })
    }

    await tx.insert(paymentProofs).values({
      objectName: input.proof.objectName,
      contentType: input.proof.contentType,
      uploadedBy: input.actorId,
      entityType: 'bank_transaction',
      entityId: transaction.id
    })

    const [updated] = await tx.update(bankTransactions)
      .set({ hasProof: true })
      .where(eq(bankTransactions.id, transaction.id))
      .returning()
    return updated
  })
}

interface TrashTransactionInput {
  transactionId: string
  actorId: string
}

// Papelera (fase 8, decisión de producto): el movimiento NO se borra, se marca. Todas las
// lecturas lo ignoran desde ese momento (saldo, conciliación, fondo común) y su justificante
// se conserva. El vínculo con los aportes se deja INTACTO (RT8-2): borrarlo obligaría a
// reconstruirlo al restaurar y perdería información; en su lugar, todas las lecturas tratan
// «vinculado a un movimiento en la papelera» como no vinculado.
export async function trashTransaction(input: TrashTransactionInput) {
  return db.transaction(tx => trashTransactionCore(tx, input))
}

// Núcleo reutilizable: el aporte por transferencia arrastra su ingreso auto-creado en la
// MISMA transacción (RT8-3), y en ese caso el acto lo origina el aporte, no el movimiento.
export async function trashTransactionCore(
  tx: TxExecutor,
  input: TrashTransactionInput & { cascadeFrom?: string }
) {
  const [transaction] = await tx.select().from(bankTransactions)
    .where(eq(bankTransactions.id, input.transactionId)).for('update')
  if (!transaction) {
    throw createError({ statusCode: 404, statusMessage: 'Movimiento no encontrado' })
  }
  // Idempotente: dos clics en «Mover a la papelera» no fallan ni reescriben quién y cuándo.
  if (transaction.deletedAt) {
    return transaction
  }

  const [updated] = await tx.update(bankTransactions)
    .set({ deletedAt: new Date(), deletedBy: input.actorId })
    .where(eq(bankTransactions.id, transaction.id))
    .returning()

  await writeAuditLog({
    actorId: input.actorId,
    action: 'bank_transaction_trashed',
    entityType: 'bank_transaction',
    entityId: transaction.id,
    metadata: {
      description: transaction.description,
      amountCents: transaction.amountCents,
      direction: transaction.direction,
      cascadeFrom: input.cascadeFrom ?? null
    }
  }, tx)

  return updated!
}

// Restaurar: con el vínculo intacto no hay nada que reconstruir (RT8-2), basta con limpiar
// la marca. Un aporte vinculado a este movimiento vuelve a contar como depositado.
export async function restoreTransaction(input: TrashTransactionInput) {
  return db.transaction(tx => restoreTransactionCore(tx, input))
}

// Núcleo reutilizable: restaurar un aporte por transferencia restaura también su ingreso
// auto-creado en la MISMA transacción.
export async function restoreTransactionCore(tx: TxExecutor, input: TrashTransactionInput) {
  const [transaction] = await tx.select().from(bankTransactions)
    .where(eq(bankTransactions.id, input.transactionId)).for('update')
  if (!transaction) {
    throw createError({ statusCode: 404, statusMessage: 'Movimiento no encontrado' })
  }
  if (!transaction.deletedAt) {
    return transaction
  }
  // Papelera de la fase 8: un mes solo puede tener un cargo automático vivo.
  if (transaction.mortgagePeriod) {
    await assertNoOtherChargeForMonth(transaction.mortgagePeriod, transaction.id)
  }

  const [updated] = await tx.update(bankTransactions)
    .set({ deletedAt: null, deletedBy: null })
    .where(eq(bankTransactions.id, transaction.id))
    .returning()

  await writeAuditLog({
    actorId: input.actorId,
    action: 'bank_transaction_restored',
    entityType: 'bank_transaction',
    entityId: transaction.id,
    metadata: { description: transaction.description, amountCents: transaction.amountCents }
  }, tx)

  return updated!
}

// Borrado definitivo (solo Admin, solo desde la papelera — RT8-4). Reutiliza el núcleo del
// borrado duro de antes: desvincula los aportes vivos que lo referenciaban (quedan
// «pendientes de depósito» si eran efectivo) y elimina el justificante de MinIO.
export async function purgeTransaction(input: TrashTransactionInput) {
  const result = await db.transaction(async (tx) => {
    const [transaction] = await tx.select().from(bankTransactions)
      .where(eq(bankTransactions.id, input.transactionId)).for('update')
    if (!transaction) {
      throw createError({ statusCode: 404, statusMessage: 'Movimiento no encontrado' })
    }
    if (!transaction.deletedAt) {
      throw createError({ statusCode: 409, statusMessage: 'Solo se puede eliminar definitivamente lo que está en la papelera' })
    }

    // Contribuciones y movimientos se referencian sin FK dura (patrón polimórfico del
    // repo): sin este update quedarían apuntando a un id inexistente.
    await tx.update(contributions)
      .set({ bankTransactionId: null, updatedAt: new Date() })
      .where(eq(contributions.bankTransactionId, transaction.id))

    const proofs = await tx.select().from(paymentProofs)
      .where(and(eq(paymentProofs.entityType, 'bank_transaction'), eq(paymentProofs.entityId, transaction.id)))
    if (proofs.length > 0) {
      await tx.delete(paymentProofs)
        .where(and(eq(paymentProofs.entityType, 'bank_transaction'), eq(paymentProofs.entityId, transaction.id)))
    }

    await tx.delete(bankTransactions).where(eq(bankTransactions.id, transaction.id))

    await writeAuditLog({
      actorId: input.actorId,
      action: 'bank_transaction_purged',
      entityType: 'bank_transaction',
      entityId: transaction.id,
      metadata: { description: transaction.description, amountCents: transaction.amountCents, direction: transaction.direction }
    }, tx)

    return { transactionId: transaction.id, proofObjectNames: proofs.map(p => p.objectName) }
  })

  // MinIO fuera de la tx (igual que antes): un fallo aquí deja un objeto huérfano
  // inofensivo, no un registro DB roto.
  for (const objectName of result.proofObjectNames) {
    await deleteFile(objectName).catch(() => null)
  }

  return { transactionId: result.transactionId }
}

export async function listTransactions() {
  return db.select().from(bankTransactions)
    .where(notDeleted(bankTransactions))
    .orderBy(asc(bankTransactions.date), asc(bankTransactions.createdAt))
}

// ---- Configuración financiera global (fila única id = 'global') ----

export interface FinanceSettings {
  purchaseDate: string | null
  quotaAmountCents: number | null
  quotaStartMonth: string | null
}

const GLOBAL_SETTINGS_ID = 'global'

export async function getSettings(): Promise<FinanceSettings> {
  const [row] = await db.select().from(financeSettings)
    .where(eq(financeSettings.id, GLOBAL_SETTINGS_ID))
  if (!row) {
    return { purchaseDate: null, quotaAmountCents: null, quotaStartMonth: null }
  }
  return {
    purchaseDate: row.purchaseDate,
    quotaAmountCents: row.quotaAmountCents,
    quotaStartMonth: row.quotaStartMonth
  }
}

interface UpdateSettingsInput {
  actorId: string
  purchaseDate: string | null
  quotaAmountCents: number | null
  quotaStartMonth: string | null
}

export async function updateSettings(input: UpdateSettingsInput): Promise<FinanceSettings> {
  // Upsert + audit en la misma tx (patrón del resto de servicios): un fallo del audit no
  // deja la mutación sin rastro.
  const row = await db.transaction(async (tx) => {
    const [upserted] = await tx.insert(financeSettings)
      .values({
        id: GLOBAL_SETTINGS_ID,
        purchaseDate: input.purchaseDate,
        quotaAmountCents: input.quotaAmountCents,
        quotaStartMonth: input.quotaStartMonth,
        updatedAt: new Date()
      })
      .onConflictDoUpdate({
        target: financeSettings.id,
        set: {
          purchaseDate: input.purchaseDate,
          quotaAmountCents: input.quotaAmountCents,
          quotaStartMonth: input.quotaStartMonth,
          updatedAt: new Date()
        }
      })
      .returning()

    await writeAuditLog({
      actorId: input.actorId,
      action: 'finance_settings_updated',
      entityType: 'finance_settings',
      entityId: GLOBAL_SETTINGS_ID,
      metadata: { purchaseDate: input.purchaseDate, quotaAmountCents: input.quotaAmountCents, quotaStartMonth: input.quotaStartMonth }
    }, tx)

    return upserted
  })

  return {
    purchaseDate: row?.purchaseDate ?? null,
    quotaAmountCents: row?.quotaAmountCents ?? null,
    quotaStartMonth: row?.quotaStartMonth ?? null
  }
}
