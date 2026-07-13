import { and, eq, sql } from 'drizzle-orm'
import { db, type TxExecutor } from '../db/client'
import { ideas, proposals, quotes, votes } from '../db/schema'
import { writeAuditLog } from '../utils/audit'
import { getPgErrorCode } from '../utils/pg-error'

export type IdeaStatus = 'new' | 'discussion' | 'promoted' | 'discarded'
export type ProposalStatus = 'voting' | 'approved'

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
