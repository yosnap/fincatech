import { and, eq, isNotNull } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeDb, setupIntegrationDb, uniqueSuffix } from '../test/integration-db'

// Hipoteca (fase 7) contra Postgres real: relleno, adopción de pagos manuales, marca de agua
// del cron e idempotencia. Las fechas se inyectan (`now`), así que los tests no dependen del
// día en que se ejecuten.
describeDb('hipoteca — relleno, adopción y cron', () => {
  const suffix = uniqueSuffix()
  const adminId = `test-mortgage-admin-${suffix}`
  let client: Awaited<ReturnType<typeof setupIntegrationDb>>
  let mortgageService: typeof import('./mortgage-service')
  let bankService: typeof import('./bank-service')
  let settingsSnapshot: { id: string, purchaseDate: string | null, quotaAmountCents: number | null, quotaStartMonth: string | null, mortgageGeneratedThrough: string | null } | null = null

  beforeAll(async () => {
    client = await setupIntegrationDb()
    mortgageService = await import('./mortgage-service')
    bankService = await import('./bank-service')

    await client.db.insert(client.schema.users).values({
      id: adminId,
      name: 'Admin Hipoteca',
      email: `${adminId}@example.test`,
      role: 'admin'
    })

    // La marca de agua vive en la fila única de configuración: se guarda para restaurarla.
    const [existing] = await client.db.select().from(client.schema.financeSettings)
      .where(eq(client.schema.financeSettings.id, 'global'))
    settingsSnapshot = existing
      ? {
          id: existing.id,
          purchaseDate: existing.purchaseDate,
          quotaAmountCents: existing.quotaAmountCents,
          quotaStartMonth: existing.quotaStartMonth,
          mortgageGeneratedThrough: existing.mortgageGeneratedThrough
        }
      : null
  })

  afterAll(async () => {
    if (!client) return
    await reset()
    await client.db.delete(client.schema.mortgageSchedule)
    // Movimientos manuales del fixture (los que no llevan marca de hipoteca).
    await client.db.delete(client.schema.bankTransactions)
      .where(eq(client.schema.bankTransactions.registeredBy, adminId))
    if (settingsSnapshot) {
      await client.db.update(client.schema.financeSettings).set({
        purchaseDate: settingsSnapshot.purchaseDate,
        quotaAmountCents: settingsSnapshot.quotaAmountCents,
        quotaStartMonth: settingsSnapshot.quotaStartMonth,
        mortgageGeneratedThrough: settingsSnapshot.mortgageGeneratedThrough
      }).where(eq(client.schema.financeSettings.id, 'global'))
    } else {
      await client.db.delete(client.schema.financeSettings).where(eq(client.schema.financeSettings.id, 'global'))
    }
    await client.db.delete(client.schema.auditLog).where(eq(client.schema.auditLog.actorId, adminId))
    await client.db.delete(client.schema.auditLog).where(eq(client.schema.auditLog.entityType, 'mortgage_schedule'))
    await client.db.delete(client.schema.auditLog).where(eq(client.schema.auditLog.entityType, 'mortgage_schedule_created'))
    await client.db.delete(client.schema.users).where(eq(client.schema.users.id, adminId))
    await client.pool.end()
  })

  async function reset() {
    // La marca de agua es global: se limpia para que cada test arranque como una instalación
    // recién configurada (afterAll la devuelve a su valor original).
    await client.db.update(client.schema.financeSettings)
      .set({ mortgageGeneratedThrough: null })
      .where(eq(client.schema.financeSettings.id, 'global'))
    await client.db.delete(client.schema.bankTransactions)
      .where(and(eq(client.schema.bankTransactions.registeredBy, adminId), isNotNull(client.schema.bankTransactions.mortgagePeriod)))
    await client.db.delete(client.schema.mortgageSchedule)
  }

  it('rellena los meses vencidos con el importe y el día de cargo del tramo, y es idempotente', async () => {
    await reset()
    await mortgageService.createScheduleEntry({ actorId: adminId, amountCents: 55_000, chargeDay: 5, effectiveFrom: '2026-09' })

    const first = await mortgageService.confirmBackfill({ actorId: adminId, now: new Date('2026-11-10T10:00:00Z') })
    expect(first.created.map(c => c.month)).toEqual(['2026-09', '2026-10', '2026-11'])
    expect(first.created[0]).toMatchObject({ date: '2026-09-05', amountCents: 55_000 })

    const charges = await mortgageService.getMortgageOverview()
    expect(charges.charges.map(c => c.month)).toEqual(['2026-09', '2026-10', '2026-11'])
    expect(charges.generatedThrough).toBe('2026-11')

    const second = await mortgageService.confirmBackfill({ actorId: adminId, now: new Date('2026-11-10T10:00:00Z') })
    expect(second.created).toEqual([])
  })

  it('adopta un pago manual como cargo del mes sin crear otro y conserva el importe', async () => {
    await reset()
    await mortgageService.createScheduleEntry({ actorId: adminId, amountCents: 55_000, chargeDay: 5, effectiveFrom: '2026-09' })

    const manual = await bankService.createTransaction({
      actorId: adminId,
      date: '2026-09-03',
      direction: 'withdrawal',
      amountCents: 55_000,
      description: 'CUOTA HIPOTECA septiembre',
      category: null
    })

    const preview = await mortgageService.previewBackfill(new Date('2026-11-10T10:00:00Z'))
    expect(preview.candidates.map(c => c.id)).toEqual([manual.id])

    const result = await mortgageService.confirmBackfill({
      actorId: adminId,
      adoptTransactionIds: [manual.id],
      now: new Date('2026-11-10T10:00:00Z')
    })
    expect(result.adopted).toEqual([{ transactionId: manual.id, month: '2026-09' }])
    expect(result.created.map(c => c.month)).toEqual(['2026-10', '2026-11'])

    const [adopted] = await client.db.select().from(client.schema.bankTransactions)
      .where(eq(client.schema.bankTransactions.id, manual.id))
    expect(adopted?.mortgagePeriod).toBe('2026-09')
    expect(adopted?.amountCents).toBe(55_000)
  })

  it('rechaza adoptar un pago que no es candidato', async () => {
    await reset()
    await mortgageService.createScheduleEntry({ actorId: adminId, amountCents: 55_000, chargeDay: 5, effectiveFrom: '2026-09' })
    const other = await bankService.createTransaction({
      actorId: adminId,
      date: '2026-09-03',
      direction: 'withdrawal',
      amountCents: 1_000,
      description: 'Luz',
      category: null
    })

    await expect(mortgageService.confirmBackfill({
      actorId: adminId,
      adoptTransactionIds: [other.id],
      now: new Date('2026-11-10T10:00:00Z')
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('un mes con el cargo en la papelera no se recrea: se ofrece restaurar', async () => {
    await reset()
    await mortgageService.createScheduleEntry({ actorId: adminId, amountCents: 55_000, chargeDay: 5, effectiveFrom: '2026-09' })
    await mortgageService.confirmBackfill({ actorId: adminId, now: new Date('2026-11-10T10:00:00Z') })

    const overview = await mortgageService.getMortgageOverview()
    const october = overview.charges.find(c => c.month === '2026-10')!
    await bankService.trashTransaction({ transactionId: october.id, actorId: adminId })

    const result = await mortgageService.confirmBackfill({ actorId: adminId, now: new Date('2026-11-10T10:00:00Z') })
    expect(result.created).toEqual([])
    expect(result.toRestore).toEqual(['2026-10'])
  })

  it('el cron espera al día de cargo y no recrea un cargo borrado a mano', async () => {
    await reset()
    await mortgageService.createScheduleEntry({ actorId: adminId, amountCents: 55_000, chargeDay: 5, effectiveFrom: '2026-09' })

    const beforeDay = await mortgageService.generateDueCharges(new Date('2026-11-03T10:00:00Z'))
    expect(beforeDay.created).toEqual(['2026-09', '2026-10'])

    const onDay = await mortgageService.generateDueCharges(new Date('2026-11-06T10:00:00Z'))
    expect(onDay.created).toEqual(['2026-11'])

    // Reiniciar el servidor o repetir el tick no duplica nada.
    const again = await mortgageService.generateDueCharges(new Date('2026-11-06T10:00:00Z'))
    expect(again.created).toEqual([])

    // Borrar el cargo de noviembre no lo recrea el cron: la marca de agua ya pasó ese mes.
    const overview = await mortgageService.getMortgageOverview()
    const november = overview.charges.find(c => c.month === '2026-11')!
    await bankService.trashTransaction({ transactionId: november.id, actorId: adminId })

    const afterTrash = await mortgageService.generateDueCharges(new Date('2026-11-20T10:00:00Z'))
    expect(afterTrash.created).toEqual([])
  })
})
