import { and, eq } from 'drizzle-orm'
import { db } from '../../../../../db/client'
import { quotes } from '../../../../../db/schema'
import { getSignedUrl } from '../../../../../services/storage'
import { requireRole } from '../../../../../utils/rbac'

// El PDF de una cotización se sirve siempre vía URL firmada temporal (nunca acceso
// público directo), igual que los comprobantes de la Fase 3.
export default defineEventHandler(async (event) => {
  requireRole(event, ['admin', 'owner', 'guest'])
  const proposalId = getRouterParam(event, 'id')
  const quoteId = getRouterParam(event, 'quoteId')
  if (!proposalId || !quoteId) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de propuesta o cotización' })
  }

  const quote = await db.query.quotes.findFirst({
    where: and(eq(quotes.id, quoteId), eq(quotes.proposalId, proposalId))
  })
  if (!quote || !quote.attachmentObjectName) {
    throw createError({ statusCode: 404, statusMessage: 'Esta cotización no tiene PDF adjunto' })
  }

  const url = await getSignedUrl(quote.attachmentObjectName)
  return { url }
})
