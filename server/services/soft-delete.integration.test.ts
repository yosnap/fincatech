import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeDb, setupIntegrationDb, uniqueSuffix } from '../test/integration-db'

// Papelera (fase 8) contra Postgres real: filtros de lectura, cascada del ingreso auto-creado,
// índices únicos con `deleted_at` y guards de purga.
describeDb('papelera — movimientos, aportes y gastos', () => {
  const suffix = uniqueSuffix()
  const adminId = `test-admin-${suffix}`
  const ownerId = `test-owner-${suffix}`
  const otherId = `test-other-${suffix}`
  const today = new Date().toISOString().slice(0, 10)

  let client: Awaited<ReturnType<typeof setupIntegrationDb>>
  let contributionService: typeof import('./contribution-service')
  let bankService: typeof import('./bank-service')
  let expenseService: typeof import('./expense-service')
  let settlementService: typeof import('./settlement-service')

  beforeAll(async () => {
    client = await setupIntegrationDb()
    contributionService = await import('./contribution-service')
    bankService = await import('./bank-service')
    expenseService = await import('./expense-service')
    settlementService = await import('./settlement-service')

    await client.db.insert(client.schema.users).values([
      { id: adminId, name: 'Admin Test', email: `${adminId}@example.test`, role: 'admin' },
      { id: ownerId, name: 'Owner Test', email: `${ownerId}@example.test`, role: 'owner' },
      { id: otherId, name: 'Other Test', email: `${otherId}@example.test`, role: 'owner' }
    ])
  })

  afterAll(async () => {
    if (!client) return
    const userIds = [adminId, ownerId, otherId]
    await client.db.delete(client.schema.paymentProofs).where(inArray(client.schema.paymentProofs.uploadedBy, userIds))
    await client.db.delete(client.schema.notificationsOutbox).where(inArray(client.schema.notificationsOutbox.userId, userIds))
    // Gastos primero: las deudas caen en cascada. Luego aportes y movimientos del fixture.
    await client.db.delete(client.schema.expenses).where(inArray(client.schema.expenses.createdBy, userIds))
    await client.db.delete(client.schema.contributions).where(inArray(client.schema.contributions.memberId, userIds))
    await client.db.delete(client.schema.bankTransactions).where(inArray(client.schema.bankTransactions.registeredBy, userIds))
    await client.db.delete(client.schema.auditLog).where(inArray(client.schema.auditLog.actorId, userIds))
    await client.db.delete(client.schema.users).where(inArray(client.schema.users.id, userIds))
    await client.pool.end()
  })

  it('una cuota en la papelera deja el mes libre y no aparece en el grid', async () => {
    const period = '2030-03'
    const created = await contributionService.createContribution({
      actorId: adminId,
      actorRole: 'admin',
      memberId: ownerId,
      amountCents: 5_000,
      type: 'quota',
      period,
      method: 'cash',
      date: today
    })
    const contributionId = created.contributions[0]!.id

    const gridBefore = await contributionService.getQuotaGrid()
    expect(gridBefore.months.some(m => m.period === period && m.cells.some(c => c.contribution?.id === contributionId))).toBe(true)

    await contributionService.trashContribution({ contributionId, actorId: adminId, actorRole: 'admin' })

    const gridAfter = await contributionService.getQuotaGrid()
    expect(gridAfter.months.some(m => m.cells.some(c => c.contribution?.id === contributionId))).toBe(false)

    // Doble papelera: idempotente (no lanza).
    await expect(contributionService.trashContribution({ contributionId, actorId: adminId, actorRole: 'admin' })).resolves.toBeTruthy()

    // El índice único ya no bloquea: se puede volver a registrar el mismo mes.
    const recreated = await contributionService.createContribution({
      actorId: adminId,
      actorRole: 'admin',
      memberId: ownerId,
      amountCents: 5_000,
      type: 'quota',
      period,
      method: 'cash',
      date: today
    })
    const recreatedId = recreated.contributions[0]!.id

    // Restaurar la antigua choca con la nueva: 409 legible (índice único miembro+mes vivo).
    await expect(contributionService.restoreContribution({
      contributionId,
      actorId: adminId,
      actorRole: 'admin'
    })).rejects.toMatchObject({ statusCode: 409 })

    // Restaurar la nueva sí funciona, y es idempotente.
    await expect(contributionService.restoreContribution({
      contributionId: recreatedId,
      actorId: adminId,
      actorRole: 'admin'
    })).resolves.toBeTruthy()

    await contributionService.purgeContribution({ contributionId, actorId: adminId })
  })

  it('un movimiento en la papelera no aparece en el listado ni en el saldo', async () => {
    const transaction = await bankService.createTransaction({
      actorId: adminId,
      date: today,
      direction: 'deposit',
      amountCents: 3_300,
      description: `Ingreso papelera ${suffix}`,
      category: null
    })

    const before = await bankService.listTransactions()
    expect(before.some(t => t.id === transaction.id)).toBe(true)

    await bankService.trashTransaction({ transactionId: transaction.id, actorId: adminId })

    const after = await bankService.listTransactions()
    expect(after.some(t => t.id === transaction.id)).toBe(false)

    // Restaurar idempotente y de vuelta en el listado.
    await bankService.restoreTransaction({ transactionId: transaction.id, actorId: adminId })
    await bankService.restoreTransaction({ transactionId: transaction.id, actorId: adminId })
    const restored = await bankService.listTransactions()
    expect(restored.some(t => t.id === transaction.id)).toBe(true)

    await bankService.trashTransaction({ transactionId: transaction.id, actorId: adminId })
    await bankService.purgeTransaction({ transactionId: transaction.id, actorId: adminId })
  })

  it('purgar exige que la fila esté en la papelera', async () => {
    const created = await contributionService.createContribution({
      actorId: adminId,
      actorRole: 'admin',
      memberId: otherId,
      amountCents: 1_100,
      type: 'extraordinary',
      period: null,
      method: 'cash',
      date: today
    })
    const contributionId = created.contributions[0]!.id

    await expect(contributionService.purgeContribution({ contributionId, actorId: adminId }))
      .rejects.toMatchObject({ statusCode: 409 })

    await contributionService.trashContribution({ contributionId, actorId: adminId, actorRole: 'admin' })
    await expect(contributionService.purgeContribution({ contributionId, actorId: adminId })).resolves.toMatchObject({ contributionId })
  })

  it('una transferencia mueve su ingreso a la papelera con ella (admin) y lo restaura', async () => {
    const created = await contributionService.createContribution({
      actorId: adminId,
      actorRole: 'admin',
      memberId: otherId,
      amountCents: 9_900,
      type: 'extraordinary',
      period: null,
      method: 'transfer',
      date: today
    })
    const contributionId = created.contributions[0]!.id
    const transactionId = created.bankTransactionId!

    // La marca de auto-creado se escribe al crear el aporte (RT8-3).
    const [transaction] = await client.db.select().from(client.schema.bankTransactions)
      .where(eq(client.schema.bankTransactions.id, transactionId))
    expect(transaction?.autoCreatedForContributionId).toBe(contributionId)

    await contributionService.trashContribution({ contributionId, actorId: adminId, actorRole: 'admin' })

    const [trashedTransaction] = await client.db.select().from(client.schema.bankTransactions)
      .where(eq(client.schema.bankTransactions.id, transactionId))
    expect(trashedTransaction?.deletedAt).not.toBeNull()

    await contributionService.restoreContribution({ contributionId, actorId: adminId, actorRole: 'admin' })

    const [restoredTransaction] = await client.db.select().from(client.schema.bankTransactions)
      .where(eq(client.schema.bankTransactions.id, transactionId))
    expect(restoredTransaction?.deletedAt).toBeNull()

    await contributionService.trashContribution({ contributionId, actorId: adminId, actorRole: 'admin' })
    await contributionService.purgeContribution({ contributionId, actorId: adminId })
    await bankService.purgeTransaction({ transactionId, actorId: adminId })
  })

  it('la fecha del gasto se puede corregir y rechaza fechas futuras (fase 3)', async () => {
    const expense = await expenseService.createExpense({
      actorId: ownerId,
      amountCents: 4_200,
      description: `Gasto fecha ${suffix}`,
      type: 'manual',
      // Participantes admin+owner para no contaminar la liquidación de `otherId`, que el test
      // siguiente usa como referencia de "sin deudas vivas".
      participantIds: [ownerId, adminId],
      hasProof: false,
      expenseDate: '2026-01-15'
    })
    expect(expense.expenseDate).toBe('2026-01-15')

    await expect(expenseService.updateExpenseDate({
      expenseId: expense.id,
      actorId: adminId,
      expenseDate: '2999-01-01'
    })).rejects.toMatchObject({ statusCode: 400 })

    const updated = await expenseService.updateExpenseDate({
      expenseId: expense.id,
      actorId: adminId,
      expenseDate: '2026-02-20'
    })
    expect(updated.expenseDate).toBe('2026-02-20')
  })

  it('un gasto en la papelera sale de la liquidación de sus participantes (RT8-1)', async () => {
    const expense = await expenseService.createExpense({
      actorId: ownerId,
      amountCents: 12_000,
      description: `Gasto papelera ${suffix}`,
      type: 'manual',
      participantIds: [ownerId, otherId],
      hasProof: false
    })

    const liveSettlement = await settlementService.getSettlement({ id: otherId, role: 'owner', banned: false })
    expect(liveSettlement.totalIOweThemCents).toBeGreaterThan(0)

    await expenseService.trashExpense({ expenseId: expense.id, actorId: adminId, actorRole: 'admin' })

    const trashedSettlement = await settlementService.getSettlement({ id: otherId, role: 'owner', banned: false })
    expect(trashedSettlement.counterparties).toEqual([])
    expect(trashedSettlement.totalIOweThemCents).toBe(0)
    expect(trashedSettlement.totalTheyOweMeCents).toBe(0)

    // Restaurar lo devuelve a la liquidación y es idempotente.
    await expenseService.restoreExpense({ expenseId: expense.id, actorId: adminId })
    const restored = await settlementService.getSettlement({ id: otherId, role: 'owner', banned: false })
    expect(restored.totalIOweThemCents).toBeGreaterThan(0)

    // Purgar exige papelera.
    await expect(expenseService.purgeExpense({ expenseId: expense.id, actorId: adminId, actorRole: 'admin' }))
      .rejects.toMatchObject({ statusCode: 409 })
  })
})
