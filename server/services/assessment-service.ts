import { and, eq, inArray } from 'drizzle-orm'
import { db, type TxExecutor } from '../db/client'
import { FONDO_COMUN_USER_ID } from '../db/seed/fondo-comun'
import { debts, expenses, proposals, quotes, tasks, users } from '../db/schema'
import { writeAuditLog } from '../utils/audit'
import { splitExpense } from './debt-splitter'
import { enqueueNotification } from './notification-service'

interface ExecuteApprovedProposalInput {
  proposalId: string
  actorId: string
}

// Núcleo, parametrizado por executor: server/api/proposals/[id]/close.post.ts compone esto
// con proposal-service.closeProposalCore dentro de UNA sola transacción — "aprobación ->
// derrama + tarea" es atómico de extremo a extremo (Key Insight de la Fase 7: "debe ser una
// TX única"), no dos transacciones separadas con una ventana de inconsistencia entre medias.
export async function executeApprovedProposalCore(tx: TxExecutor, input: ExecuteApprovedProposalInput) {
  const [proposal] = await tx.select().from(proposals).where(eq(proposals.id, input.proposalId)).for('update')
  if (!proposal) {
    throw createError({ statusCode: 404, statusMessage: 'Propuesta no encontrada' })
  }
  if (proposal.status !== 'approved' || !proposal.winningQuoteId) {
    throw createError({ statusCode: 400, statusMessage: 'La propuesta no está aprobada con una opción ganadora' })
  }

  const existingExpense = await tx.query.expenses.findFirst({ where: eq(expenses.originProposalId, proposal.id) })
  if (existingExpense) {
    const existingTask = await tx.query.tasks.findFirst({ where: eq(tasks.originProposalId, proposal.id) })
    return { expense: existingExpense, task: existingTask ?? null }
  }

  const winningQuote = await tx.query.quotes.findFirst({ where: eq(quotes.id, proposal.winningQuoteId) })
  if (!winningQuote) {
    throw createError({ statusCode: 500, statusMessage: 'La cotización ganadora ya no existe' })
  }

  const participants = await tx.select({ id: users.id })
    .from(users)
    .where(and(eq(users.banned, false), inArray(users.role, ['admin', 'owner'])))
  const participantIds = participants.map(p => p.id)
  if (participantIds.length === 0) {
    throw createError({ statusCode: 500, statusMessage: 'No hay copropietarios activos para repartir la derrama' })
  }

  const shares = splitExpense(winningQuote.priceCents, participantIds)

  const [expense] = await tx.insert(expenses).values({
    createdBy: FONDO_COMUN_USER_ID,
    amountCents: winningQuote.priceCents,
    description: `Derrama: ${proposal.title} (${winningQuote.label})`,
    type: 'derrama',
    hasProof: true,
    status: 'pending',
    participantSnapshot: shares,
    originProposalId: proposal.id
  }).returning()
  if (!expense) {
    throw createError({ statusCode: 500, statusMessage: 'No se pudo crear la derrama' })
  }

  // A diferencia de un gasto normal, aquí NO se excluye a nadie: todos deben al fondo
  // común porque nadie ha adelantado el dinero todavía.
  await tx.insert(debts).values(shares.map(share => ({
    expenseId: expense.id,
    debtorId: share.userId,
    creditorId: FONDO_COMUN_USER_ID,
    amountCents: share.amountCents,
    status: 'pending'
  })))

  const [task] = await tx.insert(tasks).values({
    title: `Ejecutar: ${proposal.title}`,
    description: proposal.description,
    priority: 'high',
    status: 'todo',
    originProposalId: proposal.id,
    createdBy: input.actorId
  }).returning()
  if (!task) {
    throw createError({ statusCode: 500, statusMessage: 'No se pudo crear la tarea de ejecución' })
  }

  await writeAuditLog({
    actorId: input.actorId,
    action: 'proposal_executed',
    entityType: 'proposal',
    entityId: proposal.id,
    metadata: { expenseId: expense.id, taskId: task.id, amountCents: winningQuote.priceCents }
  }, tx)

  for (const share of shares) {
    await enqueueNotification({
      userId: share.userId,
      eventType: 'derrama_created',
      subject: 'Nueva derrama',
      body: `Se ha generado una derrama de ${(share.amountCents / 100).toFixed(2)}€ por "${proposal.title}".`
    }, tx)
  }

  return { expense, task }
}

// Uso independiente (p.ej. reintentar manualmente si una propuesta quedó aprobada sin
// ejecutar por algún motivo excepcional): abre su propia transacción. Idempotente igual que
// el núcleo — llamarla dos veces nunca duplica la derrama ni la tarea.
export async function executeApprovedProposal(input: ExecuteApprovedProposalInput) {
  return db.transaction(tx => executeApprovedProposalCore(tx, input))
}
