import { z } from 'zod'
import { db } from '../../db/client'
import { notificationPreferences } from '../../db/schema'
import { requireRole } from '../../utils/rbac'

const bodySchema = z.object({
  telegramEnabled: z.boolean(),
  emailEnabled: z.boolean()
})

export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner', 'guest'])

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Datos inválidos', data: parsed.error.flatten() })
  }
  const body = parsed.data

  await db.insert(notificationPreferences)
    .values({ userId: actor.id, telegramEnabled: body.telegramEnabled, emailEnabled: body.emailEnabled })
    .onConflictDoUpdate({
      target: notificationPreferences.userId,
      set: { telegramEnabled: body.telegramEnabled, emailEnabled: body.emailEnabled }
    })

  return body
})
