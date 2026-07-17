import { ensureFondoComunUser } from '../db/seed/fondo-comun'

export default defineNitroPlugin(async () => {
  // Mismo motivo que env-check.ts: sin DB real disponible durante el prerender de build.
  if (import.meta.prerender) return
  await ensureFondoComunUser()
})
