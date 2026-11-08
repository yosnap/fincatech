import { auth } from '../utils/auth'

// Estado por-request (nunca en singletons): hidrata event.context.user en cada request.
export default defineEventHandler(async (event) => {
  // /mcp se autentica con el token Bearer de OAuth (plugin mcp de Better Auth), nunca con
  // la cookie de sesión: ahorrarse el lookup de sesión aquí no cambia nada de seguridad
  // (el guard del endpoint no mira context.user) pero evita una lectura de BD por petición.
  if (event.path.startsWith('/mcp') || event.path.startsWith('/.well-known/')) {
    event.context.user = null
    return
  }
  const session = await auth.api.getSession({ headers: event.headers })
  event.context.user = session && !session.user.pendingApproval
    ? { id: session.user.id, role: session.user.role ?? 'guest', banned: session.user.banned ?? false }
    : null
})
