import { eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { proposals } from '../../db/schema'
import { writeAuditLog } from '../../utils/audit'
import { requireRole } from '../../utils/rbac'

// Borrado definitivo: solo Admin, y solo desde la papelera (propuesta ya cancelada).
// Cotizaciones, votos y fotos asociadas se borran en cascada a nivel de FK. Todo en una
// transacción con lock de fila (mismo motivo que ideas/[id].delete.ts).
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de propuesta' })
  }

  await db.transaction(async (tx) => {
    const [proposal] = await tx.select().from(proposals).where(eq(proposals.id, id)).for('update')
    if (!proposal) {
      throw createError({ statusCode: 404, statusMessage: 'Propuesta no encontrada' })
    }
    if (proposal.status !== 'cancelled') {
      throw createError({ statusCode: 400, statusMessage: 'Solo se puede eliminar definitivamente una propuesta cancelada' })
    }

    await tx.delete(proposals).where(eq(proposals.id, id))

    await writeAuditLog({
      actorId: actor.id,
      action: 'proposal_deleted_permanently',
      entityType: 'proposal',
      entityId: id,
      metadata: { title: proposal.title }
    }, tx)
  })

  return { success: true }
})
