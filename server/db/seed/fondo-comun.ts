import { eq } from 'drizzle-orm'
import { db } from '../client'
import { users } from '../schema'

// Id fijo y estable: la Fase 7 (derramas) referencia este usuario por constante, sin query.
export const FONDO_COMUN_USER_ID = 'system-fondo-comun'

// Usuario sistema, no autenticable (sin fila en `accounts`, banned=true como defensa extra):
// acreedor de las derramas cuando nadie ha adelantado el dinero todavía (Fase 7).
export async function ensureFondoComunUser() {
  const existing = await db.query.users.findFirst({ where: eq(users.id, FONDO_COMUN_USER_ID) })
  if (existing) return

  await db.insert(users).values({
    id: FONDO_COMUN_USER_ID,
    name: 'Fondo Común',
    email: 'fondo-comun@system.local',
    emailVerified: true,
    role: 'fondo',
    banned: true,
    banReason: 'Usuario de sistema, no autenticable'
  }).onConflictDoNothing()
}
