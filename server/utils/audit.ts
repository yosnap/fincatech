import { db } from '../db/client'
import { auditLog } from '../db/schema'
import { currentChannel, type AuditChannel } from './audit-channel'

interface AuditLogInput {
  actorId: string | null
  action: string
  entityType: string
  entityId?: string | null
  metadata?: Record<string, unknown>
  // Explícito solo cuando la fila viene de un sitio que no puede ambientar canal; lo normal es
  // dejar que `runWithChannel` lo ponga (mcp/telegram/system) y caer en 'web'.
  channel?: AuditChannel
}

type Inserter = Pick<typeof db, 'insert'>

// Tabla de solo-inserción (server/db/schema/audit-log.ts): nunca update/delete desde la app.
// Acepta un `executor` opcional (una tx de db.transaction) para que el registro de auditoría
// participe en la MISMA transacción que la mutación de negocio (atomicidad real en
// server/services/expense-service.ts) — por defecto usa el pool global (Fase 2).
export async function writeAuditLog(input: AuditLogInput, executor: Inserter = db) {
  await executor.insert(auditLog).values({
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    // El canal viaja SIEMPRE en la metadata (fase 4): es lo que permite auditar «esto se hizo
    // desde Telegram» sin cambiar el esquema de la tabla.
    metadata: {
      ...input.metadata,
      channel: input.channel ?? (input.metadata?.channel as string | undefined) ?? currentChannel()
    }
  })
}
