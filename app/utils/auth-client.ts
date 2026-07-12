import { createAuthClient } from 'better-auth/vue'
import { adminClient } from 'better-auth/client/plugins'

// adminClient tipa session.user.role/banned (campos del plugin admin del servidor)
// sin necesidad de casts `as { role?: string }` en las páginas/middleware.
export const authClient = createAuthClient({
  plugins: [adminClient()]
})
