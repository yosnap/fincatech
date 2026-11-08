import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { db, type TxExecutor } from '../db/client'
import { debts, expenses, ideas, media, proposals, quotes, referenceLinks, tasks, users, votes } from '../db/schema'
import { writeAuditLog } from '../utils/audit'
import { resolveMediaUrls } from '../utils/media-urls'
import { getPgErrorCode } from '../utils/pg-error'
import { getUserNameMap } from '../utils/user-names'

export type IdeaStatus = 'new' | 'discussion' | 'promoted' | 'discarded'
export type ProposalStatus = 'voting' | 'approved' | 'cancelled'

interface PromoteIdeaInput {
  ideaId: string
  actorId: string
  actorRole: string
}

// Idea -> Propuesta: hereda título/descripción, queda enlazada al origen, marca la idea
// 'promoted'. Solo Admin o el autor de la idea pueden promover.
export async function promoteIdea(input: PromoteIdeaInput) {
  return db.transaction(async (tx) => {
    const [idea] = await tx.select().from(ideas).where(eq(ideas.id, input.ideaId)).for('update')
    if (!idea) {
      throw createError({ statusCode: 404, statusMessage: 'Idea no encontrada' })
    }
    if (idea.status === 'promoted') {
      throw createError({ statusCode: 400, statusMessage: 'La idea ya fue promovida' })
    }
    if (idea.status === 'discarded') {
      throw createError({ statusCode: 400, statusMessage: 'No se puede promover una idea descartada' })
    }
    if (input.actorRole !== 'admin' && idea.authorId !== input.actorId) {
      throw createError({ statusCode: 403, statusMessage: 'Solo el Admin o el autor pueden promover esta idea' })
    }

    const [proposal] = await tx.insert(proposals).values({
      title: idea.title,
      description: idea.description,
      authorId: input.actorId,
      originIdeaId: idea.id
    }).returning()
    if (!proposal) {
      throw createError({ statusCode: 500, statusMessage: 'No se pudo crear la propuesta' })
    }

    await tx.update(ideas).set({ status: 'promoted', updatedAt: new Date() }).where(eq(ideas.id, idea.id))

    await writeAuditLog({
      actorId: input.actorId,
      action: 'idea_promoted',
      entityType: 'idea',
      entityId: idea.id,
      metadata: { proposalId: proposal.id }
    }, tx)

    return proposal
  })
}

interface CastVoteInput {
  proposalId: string
  quoteId: string
  voterId: string
}

// UNIQUE(voter, proposal) en el schema garantiza un solo voto por propietario y propuesta,
// incluso ante dos requests concurrentes del mismo usuario (Postgres rechaza la segunda).
export async function castVote(input: CastVoteInput) {
  return db.transaction(async (tx) => {
    const [proposal] = await tx.select().from(proposals).where(eq(proposals.id, input.proposalId)).for('update')
    if (!proposal) {
      throw createError({ statusCode: 404, statusMessage: 'Propuesta no encontrada' })
    }
    if (proposal.status !== 'voting') {
      throw createError({ statusCode: 400, statusMessage: 'La votación de esta propuesta ya está cerrada' })
    }

    const quote = await tx.query.quotes.findFirst({
      where: and(eq(quotes.id, input.quoteId), eq(quotes.proposalId, input.proposalId))
    })
    if (!quote) {
      throw createError({ statusCode: 400, statusMessage: 'La opción de cotización no pertenece a esta propuesta' })
    }

    try {
      await tx.insert(votes).values({ proposalId: input.proposalId, quoteId: input.quoteId, voterId: input.voterId })
    } catch (error) {
      // 23505 = unique_violation (Postgres): el único caso esperado es voto duplicado.
      // Cualquier otro error (caída de conexión, deadlock...) se relanza tal cual — no lo
      // disfrazamos de "ya votaste", que ocultaría un fallo real de infraestructura.
      if (getPgErrorCode(error) === '23505') {
        throw createError({ statusCode: 409, statusMessage: 'Ya emitiste tu voto en esta propuesta' })
      }
      throw error
    }

    await writeAuditLog({
      actorId: input.voterId,
      action: 'vote_cast',
      entityType: 'proposal',
      entityId: input.proposalId,
      metadata: { quoteId: input.quoteId }
    }, tx)
  })
}

interface CloseProposalInput {
  proposalId: string
  actorId: string
  actorRole: string
  // Solo Admin, y solo para desempates o cierres sin votos (ver más abajo).
  overrideQuoteId?: string
}

// Núcleo de la lógica de cierre, parametrizado por executor: permite que
// server/api/proposals/[id]/close.post.ts componga esto con
// assessment-service.executeApprovedProposalCore dentro de UNA sola transacción (aprobación
// -> derrama + tarea es atómico de extremo a extremo, no dos transacciones separadas).
export async function closeProposalCore(tx: TxExecutor, input: CloseProposalInput) {
  const [proposal] = await tx.select().from(proposals).where(eq(proposals.id, input.proposalId)).for('update')
  if (!proposal) {
    throw createError({ statusCode: 404, statusMessage: 'Propuesta no encontrada' })
  }
  if (proposal.status === 'approved') {
    return proposal
  }
  if (proposal.status === 'cancelled') {
    throw createError({ statusCode: 400, statusMessage: 'Esta propuesta fue cancelada y ya no admite cierre' })
  }
  // Coincide con Security Considerations del plan: "solo Admin o autor... cierra".
  if (input.actorRole !== 'admin' && proposal.authorId !== input.actorId) {
    throw createError({ statusCode: 403, statusMessage: 'Solo el Admin o el autor pueden cerrar esta propuesta' })
  }

  const proposalQuotes = await tx.select().from(quotes).where(eq(quotes.proposalId, input.proposalId))
  if (proposalQuotes.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'No hay cotizaciones para cerrar la votación' })
  }

  let winningQuoteId: string

  if (input.overrideQuoteId) {
    if (input.actorRole !== 'admin') {
      throw createError({ statusCode: 403, statusMessage: 'Solo el Admin puede forzar la opción ganadora' })
    }
    if (!proposalQuotes.some(q => q.id === input.overrideQuoteId)) {
      throw createError({ statusCode: 400, statusMessage: 'La cotización forzada no pertenece a esta propuesta' })
    }
    winningQuoteId = input.overrideQuoteId
  } else {
    const tally = await tx.select({ quoteId: votes.quoteId, count: sql<number>`count(*)::int` })
      .from(votes)
      .where(eq(votes.proposalId, input.proposalId))
      .groupBy(votes.quoteId)
    const sorted = [...tally].sort((a, b) => b.count - a.count)
    const top = sorted[0]
    const isTie = sorted.length > 1 && sorted[1] != null && sorted[1].count === top?.count
    if (!top || top.count === 0 || isTie) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Empate o sin votos: el Admin debe cerrar indicando la opción ganadora (overrideQuoteId)'
      })
    }
    winningQuoteId = top.quoteId
  }

  const [updated] = await tx.update(proposals)
    .set({ status: 'approved', winningQuoteId, closedAt: new Date(), closedBy: input.actorId, updatedAt: new Date() })
    .where(eq(proposals.id, proposal.id))
    .returning()
  if (!updated) {
    throw createError({ statusCode: 500, statusMessage: 'No se pudo cerrar la propuesta' })
  }

  await writeAuditLog({
    actorId: input.actorId,
    action: 'proposal_closed',
    entityType: 'proposal',
    entityId: proposal.id,
    metadata: { winningQuoteId, override: !!input.overrideQuoteId }
  }, tx)

  return updated
}

// Uso independiente (fuera del flujo de ejecución de la Fase 7): abre su propia transacción.
export async function closeProposal(input: CloseProposalInput) {
  return db.transaction(tx => closeProposalCore(tx, input))
}

interface CancelProposalInput {
  proposalId: string
  actorId: string
  actorRole: string
}

// Soft-delete: nunca se borra físicamente una propuesta (preserva auditoría, cotizaciones,
// votos y fotos ya asociadas). Solo se puede cancelar mientras sigue en votación — una
// propuesta 'approved' ya generó derrama+tarea (Fase 7), cancelarla dejaría esos registros
// huérfanos de una propuesta "eliminada".
export async function cancelProposal(input: CancelProposalInput) {
  return db.transaction(async (tx) => {
    const [proposal] = await tx.select().from(proposals).where(eq(proposals.id, input.proposalId)).for('update')
    if (!proposal) {
      throw createError({ statusCode: 404, statusMessage: 'Propuesta no encontrada' })
    }
    if (proposal.status !== 'voting') {
      throw createError({ statusCode: 400, statusMessage: 'Solo se puede cancelar una propuesta en votación' })
    }
    if (input.actorRole !== 'admin' && proposal.authorId !== input.actorId) {
      throw createError({ statusCode: 403, statusMessage: 'Solo el Admin o el autor pueden cancelar esta propuesta' })
    }

    const [updated] = await tx.update(proposals)
      .set({ status: 'cancelled', closedAt: new Date(), closedBy: input.actorId, updatedAt: new Date() })
      .where(eq(proposals.id, proposal.id))
      .returning()
    if (!updated) {
      throw createError({ statusCode: 500, statusMessage: 'No se pudo cancelar la propuesta' })
    }

    await writeAuditLog({
      actorId: input.actorId,
      action: 'proposal_cancelled',
      entityType: 'proposal',
      entityId: proposal.id
    }, tx)

    return updated
  })
}

interface DeleteProposalInput {
  proposalId: string
  actorId: string
}

// Borrado definitivo (solo Admin). Dos casos válidos:
// - Cancelada: nunca llegó a ejecutarse, no generó derrama — borrado simple.
// - Aprobada: SOLO si nadie ha pagado ni confirmado nada de la derrama que se generó al
//   aprobarla (todas sus deudas siguen 'pending', bloqueado con FOR UPDATE para que un pago
//   concurrente no se cuele entre el check y el borrado). Si algún propietario ya adelantó
//   dinero, se bloquea para siempre: borrar destruiría un registro financiero real.
//   Al borrar una aprobada se elimina también la derrama (gasto+deudas en cascada), la tarea
//   de ejecución generada junto a ella, y los enlaces de referencia de ambas (tabla
//   polimórfica sin FK real). Cotizaciones, votos y fotos de la propuesta se borran en
//   cascada a nivel de FK.
export async function deleteProposalPermanently(input: DeleteProposalInput) {
  return db.transaction(async (tx) => {
    const [proposal] = await tx.select().from(proposals).where(eq(proposals.id, input.proposalId)).for('update')
    if (!proposal) {
      throw createError({ statusCode: 404, statusMessage: 'Propuesta no encontrada' })
    }
    if (proposal.status !== 'cancelled' && proposal.status !== 'approved') {
      throw createError({ statusCode: 400, statusMessage: 'Solo se puede eliminar definitivamente una propuesta cancelada o aprobada' })
    }

    let removedExpenseId: string | null = null
    let removedTaskId: string | null = null

    if (proposal.status === 'approved') {
      // Sin filtro de papelera a propósito (RT8-9): la derrama de esta propuesta se encuentra
      // aunque esté en la papelera. La propuesta se elimina definitivamente y su rastro debe
      // desaparecer del todo, papelera incluida.
      const [expense] = await tx.select().from(expenses).where(eq(expenses.originProposalId, input.proposalId)).for('update')
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
        // Si la derrama estaba en la papelera, además del borrado físico queda constancia del
        // purgado con su origen, para no perder el rastro de por qué desapareció.
        if (expense.deletedAt) {
          await writeAuditLog({
            actorId: input.actorId,
            action: 'expense_purged',
            entityType: 'expense',
            entityId: expense.id,
            metadata: { description: expense.description, amountCents: expense.amountCents, cascadeFrom: input.proposalId }
          }, tx)
        }
      }

      const [task] = await tx.select().from(tasks).where(eq(tasks.originProposalId, input.proposalId)).for('update')
      if (task) {
        await tx.delete(referenceLinks).where(and(eq(referenceLinks.entityType, 'task'), eq(referenceLinks.entityId, task.id)))
        await tx.delete(tasks).where(eq(tasks.id, task.id))
        removedTaskId = task.id
      }
    }

    await tx.delete(referenceLinks).where(and(eq(referenceLinks.entityType, 'proposal'), eq(referenceLinks.entityId, input.proposalId)))
    await tx.delete(proposals).where(eq(proposals.id, input.proposalId))

    await writeAuditLog({
      actorId: input.actorId,
      action: 'proposal_deleted_permanently',
      entityType: 'proposal',
      entityId: input.proposalId,
      metadata: { title: proposal.title, removedExpenseId, removedTaskId }
    }, tx)
  })

  return { success: true as const }
}

// ---- Lecturas compartidas con el servidor MCP (fase 4) ----

// Las canceladas quedan ocultas del listado normal para TODOS los roles (incluido Admin) —
// solo visibles en la papelera.
export async function listProposals() {
  const rows = await db.query.proposals.findMany({
    where: ne(proposals.status, 'cancelled'),
    orderBy: [desc(proposals.createdAt)]
  })
  const nameMap = await getUserNameMap(rows.map(p => p.authorId))
  return rows.map(p => ({ ...p, authorName: nameMap.get(p.authorId) ?? p.authorId }))
}

// Detalle con cotizaciones, votos y fotos. `voterId` es quien consulta (para marcar su voto);
// el total de votantes elegibles se calcula sobre admin/owner activos, igual que el alta de
// participantes.
export async function getProposalDetail(proposalId: string, voterId: string | null) {
  const proposal = await db.query.proposals.findFirst({ where: eq(proposals.id, proposalId) })
  if (!proposal) {
    throw createError({ statusCode: 404, statusMessage: 'Propuesta no encontrada' })
  }

  const proposalQuotes = await db.query.quotes.findMany({ where: eq(quotes.proposalId, proposalId) })

  const tally = await db.select({ quoteId: votes.quoteId, count: sql<number>`count(*)::int` })
    .from(votes)
    .where(eq(votes.proposalId, proposalId))
    .groupBy(votes.quoteId)
  const tallyMap = Object.fromEntries(tally.map(t => [t.quoteId, t.count]))

  const myVote = voterId
    ? await db.query.votes.findFirst({ where: and(eq(votes.proposalId, proposalId), eq(votes.voterId, voterId)) })
    : undefined

  const photos = await db.query.media.findMany({
    where: eq(media.proposalId, proposalId),
    orderBy: (m, { desc }) => [desc(m.createdAt)]
  })

  const nameMap = await getUserNameMap([proposal.authorId])

  const votedCount = tally.reduce((sum, t) => sum + t.count, 0)
  const eligibleVoters = await db.select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.banned, false), inArray(users.role, ['admin', 'owner'])))
  const totalEligibleVoters = eligibleVoters[0]?.count ?? 0

  return {
    proposal: { ...proposal, authorName: nameMap.get(proposal.authorId) ?? proposal.authorId },
    quotes: proposalQuotes.map(q => ({ ...q, voteCount: tallyMap[q.id] ?? 0 })),
    myVoteQuoteId: myVote?.quoteId ?? null,
    media: await resolveMediaUrls(photos),
    votedCount,
    totalEligibleVoters
  }
}
