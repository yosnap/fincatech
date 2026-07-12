import { z } from 'zod'
import { auth } from '../../../utils/auth'
import { requireRole, roleSchema } from '../../../utils/rbac'
import { writeAuditLog } from '../../../utils/audit'

const bodySchema = z.object({
  role: roleSchema
})

export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])
  const targetId = getRouterParam(event, 'id')
  if (!targetId) {
    throw createError({ statusCode: 400, statusMessage: 'Falta id de miembro' })
  }
  if (targetId === actor.id) {
    throw createError({ statusCode: 400, statusMessage: 'Un admin no puede cambiar su propio rol (evita auto-bloqueo)' })
  }

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Datos inválidos', data: parsed.error.flatten() })
  }
  const { role } = parsed.data

  const { user } = await auth.api.setRole({
    body: { userId: targetId, role },
    headers: event.headers
  })

  await writeAuditLog({
    actorId: actor.id,
    action: 'member_role_changed',
    entityType: 'user',
    entityId: targetId,
    metadata: { newRole: role }
  })

  return { member: { id: user.id, role } }
})
