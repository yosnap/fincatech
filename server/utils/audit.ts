import { db } from '../db/client'
import { auditLog } from '../db/schema'

interface AuditLogInput {
  actorId: string | null
  action: string
  entityType: string
  entityId?: string | null
  metadata?: Record<string, unknown>
}

// Tabla de solo-inserción (server/db/schema/audit-log.ts): nunca update/delete desde la app.
export async function writeAuditLog(input: AuditLogInput) {
  await db.insert(auditLog).values({
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    metadata: input.metadata ?? null
  })
}
