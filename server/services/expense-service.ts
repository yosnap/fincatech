import { and, eq, inArray } from 'drizzle-orm'
import { db, type TxExecutor } from '../db/client'
import { debts, expenses, paymentProofs, users } from '../db/schema'
import { writeAuditLog } from '../utils/audit'
import { isFutureMadridDate, todayInMadrid } from '../utils/madrid-date'
import { assertNotTrashed, listLiveDebts, listLiveDebtsByExpense, listLiveExpenses } from '../utils/soft-delete'
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
  // Fecha del gasto (cuándo se pagó). Sin ella se usa hoy en Madrid: la fecha de alta y la del
  // gasto coinciden en el caso normal, y el admin puede corregirla después.
  expenseDate?: string
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
      expenseDate: input.expenseDate ?? todayInMadrid(),
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
  // Opcional: si no se sube justificante, la cuota igualmente pasa a "pendiente de
  // confirmación" — el acreedor o el Admin siguen teniendo que confirmar que la recibieron,
  // así que declarar el pago sin foto no basta por sí solo para darlo por definitivo.
  proof?: { objectName: string, contentType: string }
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

    // RT8-5: el gasto se bloquea FOR SHARE después de la deuda y se rechaza la operación si
    // está en la papelera. Sin esto, un pago podría colarse sobre un gasto que el Admin acaba
    // de mandar a la papelera y quedar un comprobante de dinero real fuera de la liquidación.
    const [paidExpense] = await tx.select().from(expenses)
      .where(eq(expenses.id, debt.expenseId)).for('share')
    if (!paidExpense) {
      throw createError({ statusCode: 404, statusMessage: 'Gasto no encontrado' })
    }
    assertNotTrashed(paidExpense, 'El gasto está en la papelera: no se puede marcar la cuota como pagada')

    if (input.proof) {
      await tx.insert(paymentProofs).values({
        objectName: input.proof.objectName,
        contentType: input.proof.contentType,
        uploadedBy: input.actorId,
        entityType: 'debt',
        entityId: debt.id
      })
    }

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
    const [expense] = await tx.select().from(expenses)
      .where(eq(expenses.id, debt.expenseId)).for('update')
    if (!expense) {
      throw createError({ statusCode: 404, statusMessage: 'Gasto no encontrado' })
    }
    assertNotTrashed(expense, 'El gasto está en la papelera: no se puede confirmar la cuota')

    await recalculateExpenseStatus(tx, debt.expenseId)

    return updated
  })
}

// Recalcula el estado agregado del gasto a partir de sus deudas. El llamador ya tiene el gasto
// bloqueado con FOR UPDATE (si no, dos deudas distintas del mismo gasto confirmadas a la vez
// podrían dejar el estado fijado en 'partial' para siempre).
async function recalculateExpenseStatus(tx: TxExecutor, expenseId: string) {
  const siblingDebts = await tx.select({ status: debts.status }).from(debts).where(eq(debts.expenseId, expenseId))
  const confirmedCount = siblingDebts.filter(d => d.status === 'confirmed').length
  const expenseStatus: ExpenseStatus = confirmedCount === siblingDebts.length
    ? 'settled'
    : confirmedCount > 0 ? 'partial' : 'pending'
  await tx.update(expenses).set({ status: expenseStatus, updatedAt: new Date() }).where(eq(expenses.id, expenseId))
}

interface AdminSettleDebtInput {
  debtId: string
  actorId: string
  actorRole: string
}

// Liquidar en nombre de otro (RT-14, decisión del usuario): el Admin da por pagada la deuda de
// un miembro que le pagó en efectivo o que se lo pidió. Nunca se suplanta al deudor: el
// `actorId` del audit es el Admin y el deudor original va en `metadata.onBehalfOf`. La deuda
// queda CONFIRMADA (el Admin es quien confirma la recepción) y el gasto recalcula su estado.
export async function adminSettleDebt(input: AdminSettleDebtInput) {
  if (input.actorRole !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: 'Solo el Admin puede liquidar la deuda de otra persona' })
  }

  return db.transaction(async (tx) => {
    // Mismo orden que el resto de mutaciones de deudas: deuda → gasto.
    const [debt] = await tx.select().from(debts).where(eq(debts.id, input.debtId)).for('update')
    if (!debt) {
      throw createError({ statusCode: 404, statusMessage: 'Cuota no encontrada' })
    }

    const [expense] = await tx.select().from(expenses).where(eq(expenses.id, debt.expenseId)).for('update')
    if (!expense) {
      throw createError({ statusCode: 404, statusMessage: 'Gasto no encontrado' })
    }
    assertNotTrashed(expense, 'El gasto está en la papelera: no se puede liquidar la cuota')

    // Idempotente: si ya estaba confirmada, no se reescribe quién ni cuándo.
    if (debt.status === 'confirmed') {
      return debt
    }

    const [updated] = await tx.update(debts)
      .set({
        status: 'confirmed',
        paidAt: debt.paidAt ?? new Date(),
        confirmedAt: new Date(),
        confirmedBy: input.actorId,
        updatedAt: new Date()
      })
      .where(eq(debts.id, debt.id))
      .returning()

    await writeAuditLog({
      actorId: input.actorId,
      action: 'debt_settled_on_behalf',
      entityType: 'debt',
      entityId: debt.id,
      metadata: {
        expenseId: debt.expenseId,
        onBehalfOf: debt.debtorId,
        previousStatus: debt.status,
        amountCents: debt.amountCents
      }
    }, tx)

    await recalculateExpenseStatus(tx, debt.expenseId)

    return updated!
  })
}

interface DeleteExpenseInput {
  expenseId: string
  actorId: string
  actorRole: string
}

// Papelera (fase 8). Se mantiene la regla de producto: un gasto con alguna cuota pagada o
// confirmada NO se puede mandar a la papelera (409) — el dinero ya cambió de manos y el
// rastro tiene que seguir visible. Admin mueve cualquiera; Propietario solo los que él dio
// de alta. El justificante se conserva: al restaurar tiene que seguir ahí.
export async function trashExpense(input: DeleteExpenseInput) {
  return db.transaction(async (tx) => {
    const [expense] = await tx.select().from(expenses).where(eq(expenses.id, input.expenseId)).for('update')
    if (!expense) {
      throw createError({ statusCode: 404, statusMessage: 'Gasto no encontrado' })
    }
    if (input.actorRole !== 'admin' && expense.createdBy !== input.actorId) {
      throw createError({ statusCode: 403, statusMessage: 'Solo puedes eliminar los gastos que tú diste de alta' })
    }
    // Idempotente: dos clics no fallan ni reescriben el rastro.
    if (expense.deletedAt) {
      return expense
    }

    // FOR UPDATE sobre TODAS las deudas (no solo las ya no-pending): sin este lock, un
    // markDebtPaid concurrente podría colarse entre este check y el update y dejar en la
    // papelera un gasto con un comprobante de pago recién subido.
    const expenseDebts = await tx.select({ status: debts.status }).from(debts)
      .where(eq(debts.expenseId, expense.id)).for('update')
    const hasPaymentTrace = expenseDebts.some(d => d.status !== 'pending')
    if (hasPaymentTrace) {
      throw createError({
        statusCode: 409,
        statusMessage: 'No se puede eliminar: ya hay cuotas pagadas o confirmadas para este gasto'
      })
    }

    const [updated] = await tx.update(expenses)
      .set({ deletedAt: new Date(), deletedBy: input.actorId, updatedAt: new Date() })
      .where(eq(expenses.id, expense.id))
      .returning()

    await writeAuditLog({
      actorId: input.actorId,
      action: 'expense_trashed',
      entityType: 'expense',
      entityId: expense.id,
      metadata: { description: expense.description, amountCents: expense.amountCents }
    }, tx)

    return updated!
  })
}

interface RestoreExpenseInput {
  expenseId: string
  actorId: string
}

// Restaurar un gasto (solo Admin): se rechaza si alguno de sus participantes ya no está
// activo, porque la liquidación volvería a incluir deudas de un miembro dado de baja
// (RT8-8). Las deudas siguen intactas en la tabla: heredan el estado del gasto.
export async function restoreExpense(input: RestoreExpenseInput) {
  return db.transaction(async (tx) => {
    const [expense] = await tx.select().from(expenses).where(eq(expenses.id, input.expenseId)).for('update')
    if (!expense) {
      throw createError({ statusCode: 404, statusMessage: 'Gasto no encontrado' })
    }
    if (!expense.deletedAt) {
      return expense
    }

    const participantIds = Array.isArray(expense.participantSnapshot)
      ? [...new Set((expense.participantSnapshot as { userId: string }[]).map(p => p.userId))]
      : []
    const rows = participantIds.length > 0
      ? await tx.select({ id: users.id, name: users.name, banned: users.banned, role: users.role })
          .from(users).where(inArray(users.id, participantIds))
      : []
    const inactiveNames = rows
      .filter(row => row.banned || (row.role !== 'admin' && row.role !== 'owner'))
      .map(row => row.name)
    if (inactiveNames.length > 0 || rows.length !== participantIds.length) {
      throw createError({
        statusCode: 409,
        statusMessage: `No se puede restaurar: hay participantes dados de baja (${inactiveNames.join(', ') || 'usuario eliminado'})`
      })
    }

    const [updated] = await tx.update(expenses)
      .set({ deletedAt: null, deletedBy: null, updatedAt: new Date() })
      .where(eq(expenses.id, expense.id))
      .returning()

    await writeAuditLog({
      actorId: input.actorId,
      action: 'expense_restored',
      entityType: 'expense',
      entityId: expense.id,
      metadata: { description: expense.description, amountCents: expense.amountCents }
    }, tx)

    return updated!
  })
}

// Borrado definitivo (solo Admin, solo desde la papelera — RT8-4). Es el borrado duro de
// siempre: deudas en cascada, comprobantes de pago y objetos de MinIO. El guard de rastro de
// pago se repite aquí porque la papelera pudo llenarse con datos antiguos.
export async function purgeExpense(input: DeleteExpenseInput) {
  const result = await db.transaction(async (tx) => {
    const [expense] = await tx.select().from(expenses).where(eq(expenses.id, input.expenseId)).for('update')
    if (!expense) {
      throw createError({ statusCode: 404, statusMessage: 'Gasto no encontrado' })
    }
    if (input.actorRole !== 'admin') {
      throw createError({ statusCode: 403, statusMessage: 'Solo el Admin puede eliminar definitivamente un gasto' })
    }
    if (!expense.deletedAt) {
      throw createError({ statusCode: 409, statusMessage: 'Solo se puede eliminar definitivamente lo que está en la papelera' })
    }

    const expenseDebts = await tx.select({ id: debts.id, status: debts.status }).from(debts)
      .where(eq(debts.expenseId, expense.id)).for('update')
    if (expenseDebts.some(d => d.status !== 'pending')) {
      throw createError({
        statusCode: 409,
        statusMessage: 'No se puede eliminar: ya hay cuotas pagadas o confirmadas para este gasto'
      })
    }

    const proofs = await tx.select().from(paymentProofs)
      .where(and(eq(paymentProofs.entityType, 'expense'), eq(paymentProofs.entityId, expense.id)))
    if (proofs.length > 0) {
      await tx.delete(paymentProofs).where(and(eq(paymentProofs.entityType, 'expense'), eq(paymentProofs.entityId, expense.id)))
    }
    // debts se borra en cascada a nivel de esquema (onDelete: 'cascade').
    await tx.delete(expenses).where(eq(expenses.id, expense.id))

    await writeAuditLog({
      actorId: input.actorId,
      action: 'expense_purged',
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

interface UpdateExpenseDateInput {
  expenseId: string
  actorId: string
  // 'YYYY-MM-DD'
  expenseDate: string
}

// Cambiar la fecha del gasto (solo Admin, fase 3): corrige un ticket registrado con la fecha
// equivocada. No toca deudas, snapshot ni importes — solo el dato de fecha, que es el que
// usan listados, exportación, estadísticas y liquidación.
export async function updateExpenseDate(input: UpdateExpenseDateInput) {
  return db.transaction(async (tx) => {
    const [expense] = await tx.select().from(expenses).where(eq(expenses.id, input.expenseId)).for('update')
    if (!expense) {
      throw createError({ statusCode: 404, statusMessage: 'Gasto no encontrado' })
    }
    assertNotTrashed(expense, 'El gasto está en la papelera: restáuralo antes de cambiar la fecha')
    if (isFutureMadridDate(input.expenseDate)) {
      throw createError({ statusCode: 400, statusMessage: 'La fecha del gasto no puede ser futura' })
    }

    const [updated] = await tx.update(expenses)
      .set({ expenseDate: input.expenseDate, updatedAt: new Date() })
      .where(eq(expenses.id, expense.id))
      .returning()

    await writeAuditLog({
      actorId: input.actorId,
      action: 'expense_date_updated',
      entityType: 'expense',
      entityId: expense.id,
      metadata: { before: expense.expenseDate, after: input.expenseDate }
    }, tx)

    return updated!
  })
}

interface UpdateExpenseParticipantsInput {
  expenseId: string
  actorId: string
  participantIds: string[]
}

// Solo participantes: importe, descripción y tipo quedan fijos (decisión de producto —
// recalcular el importe con deudas ya generadas es mucho más delicado). Igual que
// deleteExpense, bloqueado si alguna cuota ya tiene rastro de pago — corrige tickets mal
// repartidos al crearlos (p. ej. antes de preseleccionar a todos los miembros), nunca
// reparte de nuevo dinero que ya cambió de manos.
export async function updateExpenseParticipants(input: UpdateExpenseParticipantsInput) {
  return db.transaction(async (tx) => {
    const [expense] = await tx.select().from(expenses).where(eq(expenses.id, input.expenseId)).for('update')
    if (!expense) {
      throw createError({ statusCode: 404, statusMessage: 'Gasto no encontrado' })
    }
    assertNotTrashed(expense, 'El gasto está en la papelera: restáuralo antes de editarlo')
    if (!input.participantIds.includes(expense.createdBy)) {
      throw createError({ statusCode: 400, statusMessage: 'El pagador debe estar entre los participantes' })
    }

    // FOR UPDATE sobre todas las deudas — mismo motivo que en deleteExpense: sin este lock,
    // un markDebtPaid concurrente podría colarse entre el check y el borrado de más abajo.
    const existingDebts = await tx.select().from(debts).where(eq(debts.expenseId, expense.id)).for('update')
    const hasPaymentTrace = existingDebts.some(d => d.status !== 'pending')
    if (hasPaymentTrace) {
      throw createError({
        statusCode: 409,
        statusMessage: 'No se puede editar: ya hay cuotas pagadas o confirmadas para este gasto'
      })
    }

    const previousDebtorIds = new Set(existingDebts.map(d => d.debtorId))
    const shares = splitExpense(expense.amountCents, input.participantIds)
    const isBankReceipt = expense.type === 'bank_receipt'

    await tx.delete(debts).where(eq(debts.expenseId, expense.id))

    const debtRows = shares
      .filter(share => share.userId !== expense.createdBy)
      .map(share => ({
        expenseId: expense.id,
        debtorId: share.userId,
        creditorId: expense.createdBy,
        amountCents: share.amountCents,
        status: (isBankReceipt ? 'confirmed' : 'pending') satisfies DebtStatus,
        confirmedAt: isBankReceipt ? new Date() : null,
        confirmedBy: isBankReceipt ? expense.createdBy : null
      }))

    if (debtRows.length > 0) {
      await tx.insert(debts).values(debtRows)
    }

    const newStatus: ExpenseStatus = isBankReceipt || shares.length === 1 ? 'settled' : 'pending'
    const [updated] = await tx.update(expenses)
      .set({ participantSnapshot: shares, status: newStatus, updatedAt: new Date() })
      .where(eq(expenses.id, expense.id))
      .returning()

    await writeAuditLog({
      actorId: input.actorId,
      action: 'expense_participants_updated',
      entityType: 'expense',
      entityId: expense.id,
      metadata: { participantIds: input.participantIds }
    }, tx)

    // Solo se notifica a quien es deudor nuevo — quien ya lo era no necesita el aviso otra vez.
    for (const debtRow of debtRows.filter(row => !previousDebtorIds.has(row.debtorId))) {
      await enqueueNotification({
        userId: debtRow.debtorId,
        eventType: 'debt_created',
        subject: 'Nueva deuda registrada',
        body: `Tienes una nueva deuda de ${(debtRow.amountCents / 100).toFixed(2)}€ por "${expense.description}".`
      }, tx)
    }

    return updated!
  })
}

interface ReassignExpenseCreatorInput {
  expenseId: string
  actorId: string
  newCreatedBy: string
}

// Solo Admin corrige quién figura como pagador (p. ej. un ticket asignado a la persona
// equivocada al darlo de alta). El nuevo pagador se añade a los participantes si no lo
// era ya — el pagador siempre debe participar. Mismo bloqueo por rastro de pago que
// updateExpenseParticipants: no tiene sentido reasignar el cobro de dinero que ya se pagó
// a la persona anterior.
export async function reassignExpenseCreator(input: ReassignExpenseCreatorInput) {
  return db.transaction(async (tx) => {
    const [expense] = await tx.select().from(expenses).where(eq(expenses.id, input.expenseId)).for('update')
    if (!expense) {
      throw createError({ statusCode: 404, statusMessage: 'Gasto no encontrado' })
    }
    assertNotTrashed(expense, 'El gasto está en la papelera: restáuralo antes de reasignarlo')
    if (expense.createdBy === input.newCreatedBy) {
      return expense
    }

    const existingDebts = await tx.select().from(debts).where(eq(debts.expenseId, expense.id)).for('update')
    const hasPaymentTrace = existingDebts.some(d => d.status !== 'pending')
    if (hasPaymentTrace) {
      throw createError({
        statusCode: 409,
        statusMessage: 'No se puede reasignar: ya hay cuotas pagadas o confirmadas para este gasto'
      })
    }

    const previousDebtorIds = new Set(existingDebts.map(d => d.debtorId))
    const previousParticipantIds = Array.isArray(expense.participantSnapshot)
      ? (expense.participantSnapshot as { userId: string }[]).map(p => p.userId)
      : []
    const participantIds = previousParticipantIds.includes(input.newCreatedBy)
      ? previousParticipantIds
      : [...previousParticipantIds, input.newCreatedBy]

    const shares = splitExpense(expense.amountCents, participantIds)
    const isBankReceipt = expense.type === 'bank_receipt'

    await tx.delete(debts).where(eq(debts.expenseId, expense.id))

    const debtRows = shares
      .filter(share => share.userId !== input.newCreatedBy)
      .map(share => ({
        expenseId: expense.id,
        debtorId: share.userId,
        creditorId: input.newCreatedBy,
        amountCents: share.amountCents,
        status: (isBankReceipt ? 'confirmed' : 'pending') satisfies DebtStatus,
        confirmedAt: isBankReceipt ? new Date() : null,
        confirmedBy: isBankReceipt ? input.newCreatedBy : null
      }))

    if (debtRows.length > 0) {
      await tx.insert(debts).values(debtRows)
    }

    const newStatus: ExpenseStatus = isBankReceipt || shares.length === 1 ? 'settled' : 'pending'
    const [updated] = await tx.update(expenses)
      .set({ createdBy: input.newCreatedBy, participantSnapshot: shares, status: newStatus, updatedAt: new Date() })
      .where(eq(expenses.id, expense.id))
      .returning()

    await writeAuditLog({
      actorId: input.actorId,
      action: 'expense_creator_reassigned',
      entityType: 'expense',
      entityId: expense.id,
      metadata: { previousCreatedBy: expense.createdBy, newCreatedBy: input.newCreatedBy }
    }, tx)

    for (const debtRow of debtRows.filter(row => !previousDebtorIds.has(row.debtorId))) {
      await enqueueNotification({
        userId: debtRow.debtorId,
        eventType: 'debt_created',
        subject: 'Nueva deuda registrada',
        body: `Tienes una nueva deuda de ${(debtRow.amountCents / 100).toFixed(2)}€ por "${expense.description}".`
      }, tx)
    }

    return updated!
  })
}

// ---- Lecturas compartidas con el servidor MCP (fase 4) ----

export interface ExpenseWithDebts {
  id: string
  description: string
  amountCents: number
  type: string
  status: string
  hasProof: boolean
  createdBy: string
  expenseDate: string
  participantCount: number
  debts: DebtRow[]
}

type DebtRow = typeof debts.$inferSelect

// Gastos vivos con sus deudas vivas. `limit` protege el contexto del modelo: el libro de una
// finca cabe de sobra, pero nunca se manda la tabla entera a un proveedor externo.
export async function listExpensesWithDebts(limit = 50): Promise<ExpenseWithDebts[]> {
  const [expenses, allDebts] = await Promise.all([listLiveExpenses(), listLiveDebts()])
  return expenses
    .sort((a, b) => b.expenseDate.localeCompare(a.expenseDate) || b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit)
    .map(expense => ({
      id: expense.id,
      description: expense.description,
      amountCents: expense.amountCents,
      type: expense.type,
      status: expense.status,
      hasProof: expense.hasProof,
      createdBy: expense.createdBy,
      expenseDate: expense.expenseDate,
      participantCount: Array.isArray(expense.participantSnapshot) ? expense.participantSnapshot.length : 0,
      debts: allDebts.filter(debt => debt.expenseId === expense.id)
    }))
}

// Deuda suelta por id (la usa la herramienta `marcar_deuda_pagada` para decidir si la cuota es
// del propio Admin o hay que liquidarla en nombre de otro — RT-14).
export async function getDebtRow(debtId: string) {
  const debt = await db.query.debts.findFirst({ where: eq(debts.id, debtId) })
  if (!debt) {
    throw createError({ statusCode: 404, statusMessage: 'Cuota no encontrada' })
  }
  return debt
}

// Detalle de un gasto con sus deudas vivas (lo que ve el Admin y la herramienta `ver_gasto`).
export async function getExpenseDetail(expenseId: string) {
  const expense = await db.query.expenses.findFirst({ where: eq(expenses.id, expenseId) })
  if (!expense) {
    throw createError({ statusCode: 404, statusMessage: 'Gasto no encontrado' })
  }
  return { expense, debts: await listLiveDebtsByExpense(expenseId) }
}
