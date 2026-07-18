import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db/client'
import { invitations, users } from '../../db/schema'
import { auth } from '../../utils/auth'
import { writeAuditLog } from '../../utils/audit'
import { roleSchema } from '../../utils/rbac'

const bodySchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
  name: z.string().min(1)
})

export default defineEventHandler(async (event) => {
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Datos inválidos', data: parsed.error.flatten() })
  }
  const body = parsed.data

  const invitation = await db.query.invitations.findFirst({
    where: eq(invitations.token, body.token)
  })

  const roleParsed = invitation ? roleSchema.safeParse(invitation.role) : undefined
  if (!invitation || invitation.usedAt || invitation.cancelledAt || invitation.expiresAt < new Date() || !roleParsed?.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invitación inválida o caducada' })
  }
  const role = roleParsed.data

  let userId: string
  try {
    const created = await auth.api.createUser({
      body: {
        email: invitation.email,
        password: body.password,
        name: body.name,
        role
      }
    })
    userId = created.user.id
  } catch (error) {
    console.error('[auth/accept-invite] fallo creando la cuenta', error)
    throw createError({ statusCode: 400, statusMessage: 'No se pudo crear la cuenta (el email ya podría estar registrado)' })
  }

  // Condicional a propósito, no un UPDATE ciego: entre el check de arriba y aquí, un Admin
  // pudo cancelar esta misma invitación (server/api/members/invitations/[id]/cancel.post.ts)
  // — createUser ya corrió y no participa de ningún lock compartido con el cancel, así que
  // esta es la única ventana donde se puede detectar la carrera. Si perdimos la carrera (0
  // filas), la cuenta ya existe pero el Admin la había cancelado mientras tanto: se banea de
  // inmediato para que la cancelación se respete igualmente, en vez de dejar una cuenta viva
  // que el Admin explícitamente rechazó.
  const [markedUsed] = await db.update(invitations)
    .set({ usedAt: new Date() })
    .where(and(eq(invitations.id, invitation.id), isNull(invitations.cancelledAt)))
    .returning()

  if (!markedUsed) {
    // auth.api.banUser exige una sesión de Admin en las cabeceras (así lo llama
    // deactivate.post.ts, con la sesión del propio Admin) — aquí no hay ninguna sesión, es
    // un endpoint público, así que se actualiza la fila directamente en vez de pasar por esa
    // API HTTP-oriented.
    await db.update(users).set({ banned: true, banReason: 'Invitación cancelada mientras se completaba el registro' }).where(eq(users.id, userId))
    await writeAuditLog({
      actorId: invitation.invitedBy,
      action: 'invitation_accepted_but_cancelled',
      entityType: 'user',
      entityId: userId,
      metadata: { email: invitation.email, role: invitation.role }
    })
    throw createError({ statusCode: 400, statusMessage: 'Esta invitación fue cancelada' })
  }

  await writeAuditLog({
    actorId: invitation.invitedBy,
    action: 'invitation_accepted',
    entityType: 'user',
    entityId: userId,
    metadata: { email: invitation.email, role: invitation.role }
  })

  try {
    const { headers } = await auth.api.signInEmail({
      body: { email: invitation.email, password: body.password },
      returnHeaders: true
    })
    for (const cookie of headers.getSetCookie()) {
      appendResponseHeader(event, 'set-cookie', cookie)
    }
  } catch {
    // La cuenta se creó igualmente; el usuario puede iniciar sesión manualmente en /login.
  }

  return { user: { id: userId, email: invitation.email, name: body.name, role: invitation.role } }
})
