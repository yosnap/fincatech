import { and, desc, eq } from 'drizzle-orm'
import { db } from '../../../../db/client'
import { paymentProofs } from '../../../../db/schema'
import { getSignedUrl } from '../../../../services/storage'
import { requireRole } from '../../../../utils/rbac'

// Justificante (ticket bancario) de un movimiento. Información comunal: cualquier
// autenticado puede verlo, igual que el propio movimiento.
export default defineEventHandler(async (event) => {
  requireRole(event, ['admin', 'owner', 'guest'])
  const transactionId = getRouterParam(event, 'id')
  if (!transactionId) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de movimiento' })
  }

  const proof = await db.query.paymentProofs.findFirst({
    where: and(eq(paymentProofs.entityType, 'bank_transaction'), eq(paymentProofs.entityId, transactionId)),
    orderBy: [desc(paymentProofs.createdAt)]
  })
  if (!proof) {
    throw createError({ statusCode: 404, statusMessage: 'Este movimiento no tiene justificante subido' })
  }

  const url = await getSignedUrl(proof.objectName)
  return { url }
})
