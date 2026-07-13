import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../db/client'
import { media, proposals, quotes, votes } from '../../db/schema'
import { requireRole } from '../../utils/rbac'

export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner', 'guest'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de propuesta' })
  }

  const proposal = await db.query.proposals.findFirst({ where: eq(proposals.id, id) })
  if (!proposal) {
    throw createError({ statusCode: 404, statusMessage: 'Propuesta no encontrada' })
  }

  const proposalQuotes = await db.query.quotes.findMany({ where: eq(quotes.proposalId, id) })

  const tally = await db.select({ quoteId: votes.quoteId, count: sql<number>`count(*)::int` })
    .from(votes)
    .where(eq(votes.proposalId, id))
    .groupBy(votes.quoteId)
  const tallyMap = Object.fromEntries(tally.map(t => [t.quoteId, t.count]))

  const myVote = actor.role !== 'guest'
    ? await db.query.votes.findFirst({ where: and(eq(votes.proposalId, id), eq(votes.voterId, actor.id)) })
    : undefined

  const photos = await db.query.media.findMany({
    where: eq(media.proposalId, id),
    orderBy: (m, { desc }) => [desc(m.createdAt)]
  })

  return {
    proposal,
    quotes: proposalQuotes.map(q => ({ ...q, voteCount: tallyMap[q.id] ?? 0 })),
    myVoteQuoteId: myVote?.quoteId ?? null,
    media: photos.map(m => ({ id: m.id, createdAt: m.createdAt, uploadedBy: m.uploadedBy }))
  }
})
