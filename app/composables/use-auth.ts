import { createAuthClient } from 'better-auth/vue'
import { adminClient, inferAdditionalFields } from 'better-auth/client/plugins'
import type { auth } from '../../server/utils/auth'

// Cliente auth "request-scoped": necesario en SSR (middlewares de ruta) porque el
// cliente singleton (app/utils/auth-client.ts) usa URLs relativas que solo resuelven
// en el navegador. Aquí forzamos baseURL absoluto y reenviamos la cookie de sesión.
// inferAdditionalFields tipa session.user.pendingApproval (igual que el singleton).
export function useAuth() {
  const url = useRequestURL()
  const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
  return createAuthClient({
    baseURL: url.origin,
    fetchOptions: { headers },
    plugins: [adminClient(), inferAdditionalFields<typeof auth>()]
  })
}
