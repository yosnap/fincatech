import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeDb, setupIntegrationDb } from '../test/integration-db'

// Test de integración contra Postgres REAL: el resto de la suite prueba funciones puras, pero
// la corrección RT-6 (comprobación de duplicado dentro de la transacción + advisory lock) no
// se puede demostrar sin dos conexiones concurrentes de verdad.
//
// Se activa solo con TEST_DATABASE_URL (una BD con las migraciones aplicadas); sin ella el
// bloque entero queda en 'skipped' y `pnpm test` sigue siendo puro:
//   TEST_DATABASE_URL=postgres://fincatech:fincatech@localhost:5438/fincatech pnpm test
describeDb('createContribution — concurrencia (RT-6)', () => {
  const memberId = `test-member-${randomUUID()}`
  const today = new Date().toISOString().slice(0, 10)
  let service: typeof import('./contribution-service')
  let client: Awaited<ReturnType<typeof setupIntegrationDb>>
  let schema: Awaited<ReturnType<typeof setupIntegrationDb>>['schema']

  beforeAll(async () => {
    const integration = await setupIntegrationDb()
    client = integration
    schema = integration.schema

    service = await import('./contribution-service')

    await client.db.insert(schema.users).values({
      id: memberId,
      name: 'Concurrencia Test',
      email: `${memberId}@example.test`,
      role: 'owner'
    })
  })

  afterAll(async () => {
    if (!service) return
    await client.db.delete(schema.contributions).where(eq(schema.contributions.memberId, memberId))
    // audit_log es de solo-inserción para la app; aquí solo se limpia el rastro del fixture,
    // que si no bloquea el borrado del usuario por FK.
    await client.db.delete(schema.auditLog).where(eq(schema.auditLog.actorId, memberId))
    await client.db.delete(schema.users).where(eq(schema.users.id, memberId))
    await client.pool.end()
  })

  it('dos envíos simultáneos del mismo aporte: uno se crea y el otro recibe 409', async () => {
    const input = {
      actorId: memberId,
      actorRole: 'owner',
      memberId,
      amountCents: 12_500,
      type: 'extraordinary' as const,
      period: null,
      method: 'cash' as const,
      date: today
    }

    const results = await Promise.allSettled([
      service.createContribution(input),
      service.createContribution(input)
    ])

    const fulfilled = results.filter(r => r.status === 'fulfilled')
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]!.reason.statusCode).toBe(409)
    expect(rejected[0]!.reason.data.code).toBe('possible_duplicate')
  })

  // Este es el que demuestra la corrección: sin el advisory lock, la comprobación lee una
  // tabla donde la otra transacción aún no ha confirmado y crea el duplicado. La transacción
  // «rival» se abre a mano, se queda con la clave bloqueada y confirma en cuanto la creación
  // está esperando — determinista, sin depender del orden del event loop.
  it('espera al advisory lock y ve el aporte de una transacción concurrente (409)', async () => {
    const amountCents = 44_400
    const input = {
      actorId: memberId,
      actorRole: 'owner',
      memberId,
      amountCents,
      type: 'extraordinary' as const,
      period: null,
      method: 'cash' as const,
      date: today,
      force: false
    }
    // Misma clave que duplicateKey() de bank-core (period null → cadena vacía).
    const key = [memberId, amountCents, 'extraordinary', today, ''].join('|')

    const rival = await client.pool.connect()
    try {
      await rival.query('begin')
      await rival.query('select pg_advisory_xact_lock(hashtext($1))', [key])
      await rival.query(
        `insert into contributions (member_id, amount_cents, type, period, method, date, registered_by)
         values ($1, $2, 'extraordinary', null, 'cash', $3, $1)`,
        [memberId, amountCents, today]
      )

      const creation = service.createContribution(input)
      // La creación está bloqueada esperando el lock: no ha podido leer todavía.
      await new Promise(resolve => setTimeout(resolve, 250))
      await rival.query('commit')

      await expect(creation).rejects.toMatchObject({
        statusCode: 409,
        data: { code: 'possible_duplicate' }
      })
    } finally {
      rival.release()
    }
  })

  it('con force: true los dos envíos se registran', async () => {
    const input = {
      actorId: memberId,
      actorRole: 'owner',
      memberId,
      amountCents: 7_300,
      type: 'extraordinary' as const,
      period: null,
      method: 'cash' as const,
      date: today,
      force: true
    }

    const results = await Promise.allSettled([
      service.createContribution(input),
      service.createContribution(input)
    ])

    expect(results.every(r => r.status === 'fulfilled')).toBe(true)
  })
})
