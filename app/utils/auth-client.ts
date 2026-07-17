import { createAuthClient } from 'better-auth/vue'
import { adminClient, inferAdditionalFields } from 'better-auth/client/plugins'
import type { auth } from '../../server/utils/auth'

// adminClient tipa session.user.role/banned (campos del plugin admin del servidor).
// inferAdditionalFields tipa session.user.pendingApproval (server/utils/auth.ts,
// user.additionalFields) — ambos evitan casts `as { role?: string }` repetidos en
// páginas/middleware.
export const authClient = createAuthClient({
  plugins: [adminClient(), inferAdditionalFields<typeof auth>()]
})
