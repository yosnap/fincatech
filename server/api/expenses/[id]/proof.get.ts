import { and, desc, eq } from 'drizzle-orm'
import { db } from '../../../db/client'
import { paymentProofs } from '../../../db/schema'
import { getSignedUrl } from '../../../services/storage'
import { requireRole } from '../../../utils/rbac'

// Justificante original del gasto (ticket/factura) — a diferencia del comprobante de pago
// de una cuota, este no involucra desglose de deuda individual, pero se restringe a
// Admin/Propietario (decisión de producto: el Invitado no accede a los tickets originales).
export default defineEventHandler(async (event) => {
  requireRole(event, ['admin', 'owner'])
  const expenseId = getRouterParam(event, 'id')
  if (!expenseId) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de gasto' })
  }

  const proof = await db.query.paymentProofs.findFirst({
    where: and(eq(paymentProofs.entityType, 'expense'), eq(paymentProofs.entityId, expenseId)),
    orderBy: [desc(paymentProofs.createdAt)]
  })
  if (!proof) {
    throw createError({ statusCode: 404, statusMessage: 'Este gasto no tiene justificante subido' })
  }

  const url = await getSignedUrl(proof.objectName)
  return { url }
})
