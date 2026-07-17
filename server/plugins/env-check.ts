import { getEnv } from '../utils/env'

export default defineNitroPlugin(() => {
  // El prerender de rutas estáticas (routeRules '/') arranca Nitro en tiempo de `build`,
  // antes de que exista ninguna variable de entorno real (esas solo las inyecta el
  // contenedor en runtime) — no debe fallar el build por esto.
  if (import.meta.prerender) return
  getEnv()
})
