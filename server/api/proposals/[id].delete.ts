import { and, eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { debts, expenses, proposals, referenceLinks, tasks } from '../../db/schema'
import { writeAuditLog } from '../../utils/audit'
import { requireRole } from '../../utils/rbac'

// Borrado definitivo: solo Admin. Dos casos válidos:
// - Cancelada: nunca llegó a ejecutarse, no generó derrama — borrado simple.
// - Aprobada: SOLO si nadie ha pagado ni confirmado nada de la derrama que se generó al
//   aprobarla (todas sus deudas siguen 'pending', bloqueado con FOR UPDATE para que un pago
//   concurrente no se cuele entre el check y el borrado). Si algún propietario ya adelantó
//   dinero, se bloquea para siempre: borrar destruiría un registro financiero real.
//   Al borrar una aprobada se elimina también la derrama (gasto+deudas en cascada), la tarea
//   de ejecución generada junto a ella, y los enlaces de referencia de ambas (tabla
//   polimórfica sin FK real). Cotizaciones, votos y fotos de la propuesta se borran en
//   cascada a nivel de FK.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de propuesta' })
  }

  await db.transaction(async (tx) => {
    const [proposal] = await tx.select().from(proposals).where(eq(proposals.id, id)).for('update')
    if (!proposal) {
      throw createError({ statusCode: 404, statusMessage: 'Propuesta no encontrada' })
    }
    if (proposal.status !== 'cancelled' && proposal.status !== 'approved') {
      throw createError({ statusCode: 400, statusMessage: 'Solo se puede eliminar definitivamente una propuesta cancelada o aprobada' })
    }

    let removedExpenseId: string | null = null
    let removedTaskId: string | null = null

    if (proposal.status === 'approved') {
      const [expense] = await tx.select().from(expenses).where(eq(expenses.originProposalId, proposal.id)).for('update')
      if (expense) {
        // Lock TODAS las deudas de la derrama, sin filtrar por status: si filtráramos por
        // "status != pending" aquí, una fila que sigue 'pending' en este instante no quedaría
        // bloqueada, y un markDebtPaid concurrente (expense-service.ts) podría colarse justo
        // entre este check y el DELETE de más abajo, dejando un pago real destruido por la
        // cascada de debts.expenseId. Bloqueando todas las filas primero, cualquier
        // markDebtPaid concurrente sobre la misma deuda queda serializado por Postgres:
        // o ya se ejecutó antes (y aquí se detecta como insegura) o espera a que esta
        // transacción termine.
        const allDebts = await tx.select().from(debts).where(eq(debts.expenseId, expense.id)).for('update')
        const unsafeDebt = allDebts.filter(d => d.status !== 'pending')
        if (unsafeDebt.length) {
          throw createError({
            statusCode: 400,
            statusMessage: 'No se puede eliminar: al menos un propietario ya pagó o confirmó su parte de la derrama generada por esta propuesta'
          })
        }
        await tx.delete(expenses).where(eq(expenses.id, expense.id))
        removedExpenseId = expense.id
      }

      const [task] = await tx.select().from(tasks).where(eq(tasks.originProposalId, proposal.id)).for('update')
      if (task) {
        await tx.delete(referenceLinks).where(and(eq(referenceLinks.entityType, 'task'), eq(referenceLinks.entityId, task.id)))
        await tx.delete(tasks).where(eq(tasks.id, task.id))
        removedTaskId = task.id
      }
    }

    await tx.delete(referenceLinks).where(and(eq(referenceLinks.entityType, 'proposal'), eq(referenceLinks.entityId, proposal.id)))
    await tx.delete(proposals).where(eq(proposals.id, id))

    await writeAuditLog({
      actorId: actor.id,
      action: 'proposal_deleted_permanently',
      entityType: 'proposal',
      entityId: id,
      metadata: { title: proposal.title, removedExpenseId, removedTaskId }
    }, tx)
  })

  return { success: true }
})
