import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeDb, setupIntegrationDb } from '../test/integration-db'

// Integración del registro de herramientas (fase 4, RT-5) contra Postgres REAL: demuestra
// que una herramienta ejecutada vía `runTool` con canal 'mcp' llega al audit log con
// `metadata.channel: mcp`, y que un no-admin se rechaza antes de tocar el servicio.
//
// Se activa solo con TEST_DATABASE_URL; sin ella el bloque queda 'skipped'.
describeDb('runTool — auditoría por canal y control de rol', () => {
  const adminId = `mcp-admin-${randomUUID()}`
  const memberId = `mcp-member-${randomUUID()}`
  let service: typeof import('./registry')
  let client: Awaited<ReturnType<typeof setupIntegrationDb>>
  let schema: Awaited<ReturnType<typeof setupIntegrationDb>>['schema']
  let contributionId: string

  beforeAll(async () => {
    const integration = await setupIntegrationDb()
    client = integration
    schema = integration.schema

    service = await import('./registry')

    await client.db.insert(schema.users).values([
      { id: adminId, name: 'MCP Admin', email: `${adminId}@example.test`, role: 'admin' },
      { id: memberId, name: 'MCP Miembro', email: `${memberId}@example.test`, role: 'owner' }
    ])

    const [created] = await client.db
      .insert(schema.contributions)
      .values({
        memberId,
        amountCents: 10_000,
        type: 'extraordinary',
        period: null,
        method: 'cash',
        date: '2026-11-01',
        registeredBy: adminId
      })
      .returning({ id: schema.contributions.id })
    if (!created) throw new Error('El fixture de aporte no se creó')
    contributionId = created.id
  })

  afterAll(async () => {
    if (!client) return
    await client.db.delete(schema.auditLog).where(eq(schema.auditLog.actorId, adminId))
    await client.db.delete(schema.contributions).where(eq(schema.contributions.memberId, memberId))
    await client.db.delete(schema.users).where(inArray(schema.users.id, [adminId, memberId]))
    await client.pool.end()
  })

  it('una edición vía runTool audita con channel: mcp', async () => {
    const result = await service.runTool(
      { id: adminId, role: 'admin', banned: false },
      'editar_aporte',
      { id: contributionId, date: '2026-10-05' },
      'mcp'
    )
    expect(result.ok).toBe(true)
    expect((result.result as { fecha: string }).fecha).toBe('2026-10-05')

    const [entry] = await client.db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.action, 'contribution_updated'), eq(schema.auditLog.entityId, contributionId)))
    if (!entry) throw new Error('Falta la entrada de auditoría contribution_updated')
    const metadata = entry.metadata as { channel?: string }
    expect(metadata.channel).toBe('mcp')
    expect(entry.actorId).toBe(adminId)
  })

  it('un no-admin es rechazado sin ejecutar la herramienta', async () => {
    const result = await service.runTool(
      { id: memberId, role: 'owner', banned: false },
      'editar_aporte',
      { id: contributionId, notes: 'no debe aplicarse' },
      'mcp'
    )
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Solo un administrador activo puede usar esta herramienta')

    const [row] = await client.db.select().from(schema.contributions).where(eq(schema.contributions.id, contributionId))
    if (!row) throw new Error('Falta el fixture de aporte')
    expect(row.notes).toBeNull()
  })
})
