import { and, desc, eq } from 'drizzle-orm'
import { db } from '../../../db/client'
import { debts, paymentProofs } from '../../../db/schema'
import { getSignedUrl } from '../../../services/storage'
import { requireRole } from '../../../utils/rbac'

// Comprobante de pago de una cuota: visible solo para Admin, el deudor o el acreedor
// implicados — nunca acceso público directo, siempre vía URL firmada temporal (Fase 1).
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner'])
  const debtId = getRouterParam(event, 'id')
  if (!debtId) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de cuota' })
  }

  const debt = await db.query.debts.findFirst({ where: eq(debts.id, debtId) })
  if (!debt) {
    throw createError({ statusCode: 404, statusMessage: 'Cuota no encontrada' })
  }
  const isInvolved = actor.role === 'admin' || debt.debtorId === actor.id || debt.creditorId === actor.id
  if (!isInvolved) {
    throw createError({ statusCode: 403, statusMessage: 'No tienes acceso a este comprobante' })
  }

  const proof = await db.query.paymentProofs.findFirst({
    where: and(eq(paymentProofs.entityType, 'debt'), eq(paymentProofs.entityId, debtId)),
    orderBy: [desc(paymentProofs.createdAt)]
  })
  if (!proof) {
    throw createError({ statusCode: 404, statusMessage: 'Esta cuota no tiene comprobante subido' })
  }

  const url = await getSignedUrl(proof.objectName)
  return { url }
})
