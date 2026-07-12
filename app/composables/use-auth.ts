import { createAuthClient } from 'better-auth/vue'
import { adminClient } from 'better-auth/client/plugins'

// Cliente auth "request-scoped": necesario en SSR (middlewares de ruta) porque el
// cliente singleton (app/utils/auth-client.ts) usa URLs relativas que solo resuelven
// en el navegador. Aquí forzamos baseURL absoluto y reenviamos la cookie de sesión.
export function useAuth() {
  const url = useRequestURL()
  const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
  return createAuthClient({
    baseURL: url.origin,
    fetchOptions: { headers },
    plugins: [adminClient()]
  })
}
