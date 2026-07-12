import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db/client'
import { invitations } from '../../db/schema'
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
  if (!invitation || invitation.usedAt || invitation.expiresAt < new Date() || !roleParsed?.success) {
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

  await db.update(invitations)
    .set({ usedAt: new Date() })
    .where(eq(invitations.id, invitation.id))

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
