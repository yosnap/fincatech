import type { IncomingMessage, ServerResponse } from 'node:http'
import { toNodeHandler } from 'better-auth/node'
import { auth } from '../../utils/auth'

// Monta login, logout y get-session de Better Auth. Las rutas nativas del plugin admin
// (/admin/set-role, /admin/ban-user, /admin/create-user, /admin/impersonate-user...) se
// bloquean a propósito: mutan usuarios sin pasar por writeAuditLog ni por los guards
// anti-autobloqueo de server/api/members/*, que son el único camino soportado para
// gestión de miembros. auth.api.setRole/banUser/createUser server-side (usados por esos
// endpoints) no pasan por este handler HTTP, así que no se ven afectados por el bloqueo.
//
// Se usa toNodeHandler (event.node.req/res) en vez de auth.handler(Request) porque h3 v2
// (Nuxt 4) no expone ya un helper tipo toWebRequest que produzca una Request con URL
// absoluta utilizable por el router interno de Better Auth (better-call). event.node solo
// existe en runtime Node (siempre el caso aquí: dev y despliegue Docker/Easypanel).
const nodeHandler = toNodeHandler(auth)

export default defineEventHandler(async (event) => {
  if (event.path.startsWith('/api/auth/admin/')) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }
  // Solo un Admin (no dado de baja) puede autorizar clientes MCP y recibir tokens OAuth:
  // el flujo del plugin (authorize → consent → token) no comprueba el rol, así que se
  // corta aquí, en el paso que emite el código de autorización. Sin sesión se deja pasar
  // (el plugin redirige al login y al volver, ya con cookie, este guard aplica).
  if (event.path.startsWith('/api/auth/mcp/authorize')) {
    const session = await auth.api.getSession({ headers: event.headers })
    if (session && (session.user.role !== 'admin' || session.user.banned || session.user.pendingApproval)) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Solo los administradores pueden autorizar aplicaciones MCP'
      })
    }
  }
  if (!event.node) {
    throw createError({ statusCode: 500, statusMessage: 'Node runtime required' })
  }
  return nodeHandler(event.node.req as IncomingMessage, event.node.res as ServerResponse)
})
