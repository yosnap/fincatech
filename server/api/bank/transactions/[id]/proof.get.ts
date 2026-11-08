import { and, desc, eq } from 'drizzle-orm'
import { db } from '../../../../db/client'
import { bankTransactions, paymentProofs } from '../../../../db/schema'
import { getSignedUrl } from '../../../../services/storage'
import { requireRole } from '../../../../utils/rbac'

// Justificante (ticket bancario) de un movimiento. Información comunal: cualquier
// autenticado puede verlo, igual que el propio movimiento.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner', 'guest'])
  const transactionId = getRouterParam(event, 'id')
  if (!transactionId) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de movimiento' })
  }

  // RT8-6: el justificante de un movimiento en la papelera solo lo ve el Admin (es quien
  // puede restaurarlo); para el resto, el movimiento no existe.
  const [transaction] = await db.select({ deletedAt: bankTransactions.deletedAt })
    .from(bankTransactions).where(eq(bankTransactions.id, transactionId))
  if (transaction?.deletedAt && actor.role !== 'admin') {
    throw createError({ statusCode: 404, statusMessage: 'Movimiento no encontrado' })
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
