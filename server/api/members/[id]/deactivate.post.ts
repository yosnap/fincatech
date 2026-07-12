import { FONDO_COMUN_USER_ID } from '../../../db/seed/fondo-comun'
import { auth } from '../../../utils/auth'
import { requireRole } from '../../../utils/rbac'
import { writeAuditLog } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])
  const targetId = getRouterParam(event, 'id')
  if (!targetId) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de miembro' })
  }
  if (targetId === actor.id) {
    throw createError({ statusCode: 400, statusMessage: 'Un admin no puede darse de baja a sí mismo' })
  }
  if (targetId === FONDO_COMUN_USER_ID) {
    throw createError({ statusCode: 400, statusMessage: 'El usuario de sistema "Fondo Común" no es un miembro gestionable' })
  }

  // Soft-delete: banUser preserva la fila (histórico contable) e impide login.
  const { user } = await auth.api.banUser({
    body: { userId: targetId, banReason: 'Baja de miembro' },
    headers: event.headers
  })

  await writeAuditLog({
    actorId: actor.id,
    action: 'member_deactivated',
    entityType: 'user',
    entityId: targetId
  })

  return { member: { id: user.id, banned: true } }
})
