import { inArray } from 'drizzle-orm'
import { db, type TxExecutor } from '../db/client'
import { users } from '../db/schema'

// Elegibilidad de participantes de un gasto (RT-3): la regla vivía duplicada en tres handlers
// (alta de gasto manual, edición de participantes y las dos confirmaciones de OCR). Ahora los
// endpoints y las herramientas del MCP comparten esta única definición: un participante debe
// ser miembro activo (admin/owner) y no estar dado de baja.

type Reader = Pick<TxExecutor, 'select'>

export async function findIneligibleParticipantIds(
  participantIds: string[],
  executor: Reader = db
): Promise<string[]> {
  if (participantIds.length === 0) return []

  const rows = await executor
    .select({ id: users.id, role: users.role, banned: users.banned })
    .from(users)
    .where(inArray(users.id, participantIds))

  const eligible = new Set(
    rows.filter(row => !row.banned && (row.role === 'admin' || row.role === 'owner')).map(row => row.id)
  )
  return participantIds.filter(id => !eligible.has(id))
}

// Variante que lanza el 400 con el mensaje que ya usaban los endpoints.
export async function assertEligibleParticipants(
  participantIds: string[],
  executor: Reader = db
): Promise<void> {
  const invalidIds = await findIneligibleParticipantIds(participantIds, executor)
  if (invalidIds.length > 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Participantes inválidos: deben ser miembros activos (admin/owner)',
      data: { invalidIds }
    })
  }
}
