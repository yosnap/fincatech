import { auth } from '../utils/auth'

// Estado por-request (nunca en singletons): hidrata event.context.user en cada request.
export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  event.context.user = session
    ? { id: session.user.id, role: session.user.role ?? 'guest', banned: session.user.banned ?? false }
    : null
})
