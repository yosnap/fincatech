import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../../db/client'
import { users } from '../../../db/schema'
import { FONDO_COMUN_USER_ID } from '../../../db/seed/fondo-comun'
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
  if (targetId === FONDO_COMUN_USER_ID) {
    throw createError({ statusCode: 400, statusMessage: 'El usuario de sistema "Fondo Común" no es un miembro gestionable' })
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

  // Cualquier cambio de rol explícito por un Admin cuenta como decisión tomada sobre una
  // cuenta pendiente de auto-registro (server/api/auth/self-register.post.ts) — se aprueba
  // aunque el Admin decida dejarla en 'guest' a propósito. setRole no toca additionalFields.
  await db.update(users).set({ pendingApproval: false }).where(eq(users.id, targetId))

  await writeAuditLog({
    actorId: actor.id,
    action: 'member_role_changed',
    entityType: 'user',
    entityId: targetId,
    metadata: { newRole: role }
  })

  return { member: { id: user.id, role } }
})
