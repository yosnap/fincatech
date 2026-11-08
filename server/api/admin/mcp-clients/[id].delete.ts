import { eq } from 'drizzle-orm'
import { db } from '../../../db/client'
import * as schema from '../../../db/schema'
import { writeAuditLog } from '../../../utils/audit'
import { requireRole } from '../../../utils/rbac'

// Revoca un cliente MCP: borra la aplicación OAuth y, por FK cascade, todos sus tokens
// (access y refresh) — el conector pierde acceso al momento. Solo Admin (fase 4).
export default defineEventHandler(async (event) => {
  const actor = requireRole(event, ['admin'])
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Falta el id del cliente' })
  }

  const [deleted] = await db
    .delete(schema.oauthApplication)
    .where(eq(schema.oauthApplication.id, id))
    .returning({ id: schema.oauthApplication.id, name: schema.oauthApplication.name })
  if (!deleted) {
    throw createError({ statusCode: 404, statusMessage: 'Cliente no encontrado' })
  }

  await writeAuditLog({
    actorId: actor.id,
    action: 'mcp_client_revoke',
    entityType: 'oauth_application',
    entityId: deleted.id,
    metadata: { name: deleted.name }
  })

  return { revoked: true, name: deleted.name }
})
