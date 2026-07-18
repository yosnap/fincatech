import { and, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { debts, expenses, paymentProofs } from '../db/schema'
import { writeAuditLog } from '../utils/audit'
import { splitExpense } from './debt-splitter'
import { enqueueNotification } from './notification-service'
import { deleteFile } from './storage'

// 'derrama' se crea exclusivamente vía assessment-service.executeApprovedProposal, nunca
// a través de createExpense (que asume un pagador único excluido de las debts).
export type ExpenseType = 'manual' | 'bank_receipt' | 'derrama'
export type ExpenseStatus = 'pending' | 'partial' | 'settled'
export type DebtStatus = 'pending' | 'pending_confirmation' | 'confirmed'

interface CreateExpenseInput {
  actorId: string
  amountCents: number
  description: string
  type: ExpenseType
  participantIds: string[]
  hasProof: boolean
  // Impuestos (IVA) ya incluidos en amountCents — informativo, extraído por OCR o a mano.
  taxCents?: number
  // Solo presentes cuando el gasto viene de la extracción OCR (Fase 4).
  ocrConfidence?: number
  ocrCostUsd?: number
  // Comprobante YA subido a MinIO (objectName) antes de llamar aquí — igual que
  // markDebtPaid, nunca se sube el archivo después de escribir en DB.
  proof?: { objectName: string, contentType: string }
}

// TX: expense + debts + audit_log en una sola transacción — una caída a mitad de camino
// hace rollback completo, nunca deja deudas huérfanas (Success Criterion de la Fase 3).
export async function createExpense(input: CreateExpenseInput) {
  if (!input.participantIds.includes(input.actorId)) {
    throw createError({ statusCode: 400, statusMessage: 'El pagador debe estar entre los participantes' })
  }

  return db.transaction(async (tx) => {
    const shares = splitExpense(input.amountCents, input.participantIds)
    const isBankReceipt = input.type === 'bank_receipt'

    const [expense] = await tx.insert(expenses).values({
      createdBy: input.actorId,
      amountCents: input.amountCents,
      description: input.description,
      type: input.type,
      hasProof: input.hasProof,
      status: isBankReceipt || shares.length === 1 ? 'settled' : 'pending',
      participantSnapshot: shares,
      taxCents: input.taxCents ?? null,
      ocrConfidence: input.ocrConfidence ?? null,
      ocrCostUsd: input.ocrCostUsd ?? null
    }).returning()
    if (!expense) {
      throw createError({ statusCode: 500, statusMessage: 'No se pudo crear el gasto' })
    }

    // El pagador ya desembolsó el 100%; solo el resto (N-1) genera una deuda hacia él.
    const debtRows = shares
      .filter(share => share.userId !== input.actorId)
      .map(share => ({
        expenseId: expense.id,
        debtorId: share.userId,
        creditorId: input.actorId,
        amountCents: share.amountCents,
        status: (isBankReceipt ? 'confirmed' : 'pending') satisfies DebtStatus,
        confirmedAt: isBankReceipt ? new Date() : null,
        confirmedBy: isBankReceipt ? input.actorId : null
      }))

    if (debtRows.length > 0) {
      await tx.insert(debts).values(debtRows)
      // PRD §4.7: "nueva deuda asignada" dispara notificación. Solo enqueue en la TX
      // (escritura barata); el envío real lo hace el dispatcher por separado.
      for (const debtRow of debtRows) {
        await enqueueNotification({
          userId: debtRow.debtorId,
          eventType: 'debt_created',
          subject: 'Nueva deuda registrada',
          body: `Tienes una nueva deuda de ${(debtRow.amountCents / 100).toFixed(2)}€ por "${input.description}".`
        }, tx)
      }
    }

    if (input.proof) {
      await tx.insert(paymentProofs).values({
        objectName: input.proof.objectName,
        contentType: input.proof.contentType,
        uploadedBy: input.actorId,
        entityType: 'expense',
        entityId: expense.id
      })
    }

    await writeAuditLog({
      actorId: input.actorId,
      action: 'expense_created',
      entityType: 'expense',
      entityId: expense.id,
      metadata: { amountCents: input.amountCents, type: input.type, participants: shares.length }
    }, tx)

    return expense
  })
}

interface MarkDebtPaidInput {
  debtId: string
  actorId: string
  proof: { objectName: string, contentType: string }
}

export async function markDebtPaid(input: MarkDebtPaidInput) {
  return db.transaction(async (tx) => {
    // FOR UPDATE: dos "marcar pagado" concurrentes de la misma cuota (doble clic, reintento
    // de red) no deben insertar dos comprobantes ni dos entradas de auditoría.
    const [debt] = await tx.select().from(debts).where(eq(debts.id, input.debtId)).for('update')
    if (!debt) {
      throw createError({ statusCode: 404, statusMessage: 'Cuota no encontrada' })
    }
    if (debt.debtorId !== input.actorId) {
      throw createError({ statusCode: 403, statusMessage: 'Solo el deudor puede marcar esta cuota como pagada' })
    }
    if (debt.status !== 'pending') {
      throw createError({ statusCode: 400, statusMessage: 'La cuota no está pendiente de pago' })
    }

    await tx.insert(paymentProofs).values({
      objectName: input.proof.objectName,
      contentType: input.proof.contentType,
      uploadedBy: input.actorId,
      entityType: 'debt',
      entityId: debt.id
    })

    const [updated] = await tx.update(debts)
      .set({ status: 'pending_confirmation', paidAt: new Date(), updatedAt: new Date() })
      .where(and(eq(debts.id, debt.id), eq(debts.status, 'pending')))
      .returning()
    if (!updated) {
      throw createError({ statusCode: 409, statusMessage: 'La cuota cambió de estado durante la operación' })
    }

    await writeAuditLog({
      actorId: input.actorId,
      action: 'debt_marked_paid',
      entityType: 'debt',
      entityId: debt.id,
      metadata: { expenseId: debt.expenseId }
    }, tx)

    return updated
  })
}

interface ConfirmDebtReceiptInput {
  debtId: string
  actorId: string
  actorRole: string
}

// SELECT ... FOR UPDATE bloquea la fila durante la transacción: si dos requests
// (Admin + acreedor) confirman a la vez, el segundo espera al primero y al releer ve
// status='confirmed', por lo que hace no-op idempotente en vez de doble acreditación.
export async function confirmDebtReceipt(input: ConfirmDebtReceiptInput) {
  return db.transaction(async (tx) => {
    const [debt] = await tx.select().from(debts).where(eq(debts.id, input.debtId)).for('update')
    if (!debt) {
      throw createError({ statusCode: 404, statusMessage: 'Cuota no encontrada' })
    }

    const isAdmin = input.actorRole === 'admin'
    const isCreditor = debt.creditorId === input.actorId
    if (!isAdmin && !isCreditor) {
      throw createError({ statusCode: 403, statusMessage: 'Solo el Admin o el acreedor original pueden confirmar' })
    }

    if (debt.status === 'confirmed') {
      return debt
    }
    if (debt.status !== 'pending_confirmation') {
      throw createError({ statusCode: 400, statusMessage: 'La cuota no está pendiente de confirmación' })
    }

    const [updated] = await tx.update(debts)
      .set({ status: 'confirmed', confirmedAt: new Date(), confirmedBy: input.actorId, updatedAt: new Date() })
      .where(eq(debts.id, debt.id))
      .returning()
    if (!updated) {
      throw createError({ statusCode: 500, statusMessage: 'No se pudo confirmar la cuota' })
    }

    await writeAuditLog({
      actorId: input.actorId,
      action: 'debt_confirmed',
      entityType: 'debt',
      entityId: debt.id,
      metadata: { expenseId: debt.expenseId }
    }, tx)

    // FOR UPDATE sobre el expense: si dos debts DISTINTAS del mismo gasto se confirman casi
    // a la vez (dos acreedores/admin distintos), sin este lock ambas transacciones podrían
    // leer el estado de las debts hermanas antes de que la otra haga commit (READ COMMITTED)
    // y dejar expenses.status fijado en 'partial' de forma permanente aunque todo esté
    // confirmado. Este lock serializa el recálculo agregado igual que el FOR UPDATE de arriba
    // serializa la propia debt.
    await tx.select({ id: expenses.id }).from(expenses).where(eq(expenses.id, debt.expenseId)).for('update')

    const siblingDebts = await tx.select({ status: debts.status }).from(debts).where(eq(debts.expenseId, debt.expenseId))
    const confirmedCount = siblingDebts.filter(d => d.status === 'confirmed').length
    const expenseStatus: ExpenseStatus = confirmedCount === siblingDebts.length
      ? 'settled'
      : confirmedCount > 0 ? 'partial' : 'pending'
    await tx.update(expenses).set({ status: expenseStatus, updatedAt: new Date() }).where(eq(expenses.id, debt.expenseId))

    return updated
  })
}

interface DeleteExpenseInput {
  expenseId: string
  actorId: string
}

// Borrado duro solo si ninguna cuota tiene rastro de pago (decisión de producto: una vez
// que un vecino subió comprobante o el Admin confirmó recepción, el gasto ya no se puede
// eliminar sin perder rastro de dinero que cambió de manos — hay que dejarlo como está).
export async function deleteExpense(input: DeleteExpenseInput) {
  const result = await db.transaction(async (tx) => {
    const [expense] = await tx.select().from(expenses).where(eq(expenses.id, input.expenseId)).for('update')
    if (!expense) {
      throw createError({ statusCode: 404, statusMessage: 'Gasto no encontrado' })
    }

    // FOR UPDATE sobre TODAS las deudas (no solo las ya no-pending): sin este lock, un
    // markDebtPaid concurrente podría colarse entre este check y el borrado de más abajo,
    // destruyendo un comprobante de pago recién subido (mismo riesgo que en
    // proposals/[id].delete.ts al borrar la derrama de una propuesta aprobada).
    const expenseDebts = await tx.select({ status: debts.status }).from(debts).where(eq(debts.expenseId, expense.id)).for('update')
    const hasPaymentTrace = expenseDebts.some(d => d.status !== 'pending')
    if (hasPaymentTrace) {
      throw createError({
        statusCode: 409,
        statusMessage: 'No se puede eliminar: ya hay cuotas pagadas o confirmadas para este gasto'
      })
    }

    const proofs = await tx.select().from(paymentProofs)
      .where(and(eq(paymentProofs.entityType, 'expense'), eq(paymentProofs.entityId, expense.id)))

    // debts se borra en cascada a nivel de esquema (onDelete: 'cascade'); paymentProofs es
    // polimórfico sin FK, hay que limpiarlo a mano aquí junto con el archivo en MinIO.
    if (proofs.length > 0) {
      await tx.delete(paymentProofs).where(and(eq(paymentProofs.entityType, 'expense'), eq(paymentProofs.entityId, expense.id)))
    }
    await tx.delete(expenses).where(eq(expenses.id, expense.id))

    // El registro de auditoría sobrevive al borrado del gasto (misma tx) — es la única
    // forma de reconstruir después qué se eliminó y quién lo hizo.
    await writeAuditLog({
      actorId: input.actorId,
      action: 'expense_deleted',
      entityType: 'expense',
      entityId: expense.id,
      metadata: { description: expense.description, amountCents: expense.amountCents }
    }, tx)

    return { expenseId: expense.id, proofObjectNames: proofs.map(p => p.objectName) }
  })

  for (const objectName of result.proofObjectNames) {
    await deleteFile(objectName).catch(() => null)
  }

  return { expenseId: result.expenseId }
}
