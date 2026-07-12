import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { db } from '../../db/client'
import { invitations } from '../../db/schema'
import { requireRole, roleSchema } from '../../utils/rbac'
import { writeAuditLog } from '../../utils/audit'
import { sendInvitationEmail } from '../../utils/email'

const bodySchema = z.object({
  email: z.string().email(),
  role: roleSchema
})

const INVITATION_TTL_MS = 48 * 60 * 60 * 1000

export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Datos inválidos', data: parsed.error.flatten() })
  }
  const { email, role } = parsed.data

  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS)

  const [invitation] = await db.insert(invitations)
    .values({ email, role, token, invitedBy: actor.id, expiresAt })
    .returning()
  if (!invitation) {
    throw createError({ statusCode: 500, statusMessage: 'No se pudo crear la invitación' })
  }

  await writeAuditLog({
    actorId: actor.id,
    action: 'invitation_created',
    entityType: 'invitation',
    entityId: invitation.id,
    metadata: { email, role }
  })

  let emailSent = true
  try {
    await sendInvitationEmail(email, token, role)
  } catch (error) {
    emailSent = false
    console.error('[members/invite] fallo enviando email de invitación', error)
  }

  return {
    // El token solo viaja en la respuesta si el email falló (fallback: el admin comparte
    // el enlace a mano). Si el email se envió, no hace falta exponerlo también aquí.
    invitation: { id: invitation.id, email, role, expiresAt, token: emailSent ? undefined : token },
    emailSent
  }
})
