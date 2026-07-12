import { ensureFondoComunUser } from '../db/seed/fondo-comun'

export default defineNitroPlugin(async () => {
  await ensureFondoComunUser()
})
