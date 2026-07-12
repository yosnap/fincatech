import { randomBytes } from 'node:crypto'
import { db } from '../../db/client'
import { telegramLinkTokens } from '../../db/schema'
import { requireRole } from '../../utils/rbac'

const TOKEN_TTL_MS = 15 * 60 * 1000

// El usuario envía el token devuelto aquí al bot como "/link TOKEN" para vincular su chat_id.
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin', 'owner'])

  const token = randomBytes(16).toString('hex')
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS)
  await db.insert(telegramLinkTokens).values({ userId: actor.id, token, expiresAt })

  return { token, expiresAt }
})
