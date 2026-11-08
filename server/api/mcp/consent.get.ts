import { eq } from 'drizzle-orm'
import { db } from '../../db/client'
import * as schema from '../../db/schema'
import { auth } from '../../utils/auth'

// Datos de la pantalla de consentimiento MCP (/oauth/consent): qué aplicación pide acceso,
// con qué scopes, y si el usuario con sesión puede consentir (solo Admin, fase 4). El
// guard del authorize ya evita que un no-admin llegue aquí, pero la pantalla se niega
// también si se abriera a mano con un consent_code envejecido de otra cuenta.
export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Inicia sesión para continuar' })
  }

  const query = getQuery(event)
  const clientId = typeof query.client_id === 'string' ? query.client_id : undefined
  const app = clientId
    ? await db.query.oauthApplication.findFirst({
        where: eq(schema.oauthApplication.clientId, clientId)
      })
    : undefined

  return {
    clientId,
    clientName: app?.name ?? 'Aplicación desconocida',
    scope: typeof query.scope === 'string' ? query.scope : '',
    isAdmin: session.user.role === 'admin' && !session.user.banned && !session.user.pendingApproval
  }
})
