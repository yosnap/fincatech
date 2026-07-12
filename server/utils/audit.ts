import { db } from '../db/client'
import { auditLog } from '../db/schema'

interface AuditLogInput {
  actorId: string | null
  action: string
  entityType: string
  entityId?: string | null
  metadata?: Record<string, unknown>
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
    metadata: input.metadata ?? null
  })
}
