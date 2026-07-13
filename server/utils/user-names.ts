import { inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { users } from '../db/schema'

// Resuelve id de usuario -> nombre para mostrar autores/comentarios en la UI.
// Accesible a cualquier rol autenticado (a diferencia de /api/expenses/participants,
// que es solo admin/owner porque sirve al selector de participantes de gastos).
export async function getUserNameMap(ids: string[]): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(ids)]
  if (!uniqueIds.length) return new Map()
  const rows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, uniqueIds))
  return new Map(rows.map(u => [u.id, u.name]))
}
