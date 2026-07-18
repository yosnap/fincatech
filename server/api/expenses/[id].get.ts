import { and, eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { debts, expenses, paymentProofs } from '../../db/schema'
import { canSeeIndividualDebt, requireRole } from '../../utils/rbac'
import { getUserNameMap } from '../../utils/user-names'

export default defineEventHandler(async (event) => {
  const user = requireRole(event, ['admin', 'owner', 'guest'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de gasto' })
  }

  const expense = await db.query.expenses.findFirst({ where: eq(expenses.id, id) })
  if (!expense) {
    throw createError({ statusCode: 404, statusMessage: 'Gasto no encontrado' })
  }

  // hasProof es solo lo que la persona marcó al crear el gasto (checkbox) — algunos gastos
  // antiguos lo tienen a true sin archivo real subido. hasStoredProof refleja si existe de
  // verdad un justificante en payment_proofs, que es lo que decide si mostrar "Ver justificante".
  const proof = await db.query.paymentProofs.findFirst({
    where: and(eq(paymentProofs.entityType, 'expense'), eq(paymentProofs.entityId, id))
  })
  const hasStoredProof = !!proof

  if (!canSeeIndividualDebt(user)) {
    // participantSnapshot contiene el desglose por persona — nunca se expone al Invitado.
    const nameMap = await getUserNameMap([expense.createdBy])
    const { participantSnapshot: _participantSnapshot, ...aggregate } = expense
    return { expense: { ...aggregate, createdByName: nameMap.get(expense.createdBy) ?? expense.createdBy, hasStoredProof } }
  }

  const participantSnapshot = Array.isArray(expense.participantSnapshot)
    ? expense.participantSnapshot as { userId: string, amountCents: number }[]
    : []
  const nameMap = await getUserNameMap([expense.createdBy, ...participantSnapshot.map(p => p.userId)])
  const createdByName = nameMap.get(expense.createdBy) ?? expense.createdBy
  // Lista de participantes con nombre ya resuelto — así el detalle del gasto muestra quién
  // participa sin tener que abrir "Editar participantes" para averiguarlo.
  const participants = participantSnapshot.map(p => ({
    userId: p.userId,
    name: nameMap.get(p.userId) ?? p.userId,
    amountCents: p.amountCents
  }))

  const expenseDebts = await db.query.debts.findMany({ where: eq(debts.expenseId, id) })
  return { expense: { ...expense, createdByName, hasStoredProof, participants, debts: expenseDebts } }
})
