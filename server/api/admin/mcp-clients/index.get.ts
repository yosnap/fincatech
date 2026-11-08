import { gt } from 'drizzle-orm'
import { db } from '../../../db/client'
import * as schema from '../../../db/schema'
import { requireRole } from '../../../utils/rbac'

// Clientes MCP conectados (OAuth) para la sección «Aplicaciones conectadas» del perfil
// del Admin (fase 4): qué aplicación tiene credenciales y cuántos tokens activos tiene.
// El borrado de un cliente revoca todos sus tokens (FK cascade).
export default defineEventHandler(async (event) => {
  requireRole(event, ['admin'])

  const [apps, liveTokens] = await Promise.all([
    db.query.oauthApplication.findMany({
      orderBy: (app, { desc }) => [desc(app.createdAt)]
    }),
    db
      .select({ clientId: schema.oauthAccessToken.clientId })
      .from(schema.oauthAccessToken)
      .where(gt(schema.oauthAccessToken.accessTokenExpiresAt, new Date()))
  ])

  const tokensByClient = new Map<string, number>()
  for (const token of liveTokens) {
    tokensByClient.set(token.clientId, (tokensByClient.get(token.clientId) ?? 0) + 1)
  }

  return {
    clients: apps.map(app => ({
      id: app.id,
      clientId: app.clientId,
      name: app.name,
      type: app.type,
      redirectUrls: app.redirectUrls.split(',').filter(Boolean),
      disabled: app.disabled,
      registeredAt: app.createdAt,
      activeTokens: tokensByClient.get(app.clientId) ?? 0
    }))
  }
})
