import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../../../db/client'
import { invitations } from '../../../../db/schema'
import { requireRole } from '../../../../utils/rbac'
import { writeAuditLog } from '../../../../utils/audit'

export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])
  const invitationId = getRouterParam(event, 'id')
  if (!invitationId) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de invitación' })
  }

  const [cancelled] = await db.update(invitations)
    .set({ cancelledAt: new Date() })
    // Solo cancela si sigue sin resolver — evita "cancelar" una ya aceptada o ya cancelada.
    .where(and(eq(invitations.id, invitationId), isNull(invitations.usedAt), isNull(invitations.cancelledAt)))
    .returning()

  if (!cancelled) {
    throw createError({ statusCode: 400, statusMessage: 'La invitación no existe o ya no está pendiente' })
  }

  await writeAuditLog({
    actorId: actor.id,
    action: 'invitation_cancelled',
    entityType: 'invitation',
    entityId: invitationId,
    metadata: { email: cancelled.email }
  })

  return { success: true }
})
