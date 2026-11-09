import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeDb, setupIntegrationDb } from '../test/integration-db'

// Confirmaciones del agente de Telegram contra Postgres REAL: una acción pendiente solo se
// ejecuta una vez, desde el chat y la cuenta de Telegram vinculados, por un admin activo y
// antes de caducar.
describeDb('confirmaciones de Telegram', () => {
  const adminId = `tg-admin-${randomUUID()}`
  const ownerId = `tg-owner-${randomUUID()}`
  const adminChat = `9${Date.now()}`
  const ownerChat = `8${Date.now()}`
  const adminTgUser = `7${Date.now()}`
  const ownerTgUser = `6${Date.now()}`
  let service: typeof import('./telegram-confirmations')
  let client: Awaited<ReturnType<typeof setupIntegrationDb>>
  let schema: Awaited<ReturnType<typeof setupIntegrationDb>>['schema']

  beforeAll(async () => {
    client = await setupIntegrationDb()
    schema = client.schema
    service = await import('./telegram-confirmations')
    await client.db.insert(schema.users).values([
      { id: adminId, name: 'TG Admin', email: `${adminId}@example.test`, role: 'admin' },
      { id: ownerId, name: 'TG Owner', email: `${ownerId}@example.test`, role: 'owner' }
    ])
    await client.db.insert(schema.telegramLinks).values([
      { userId: adminId, chatId: adminChat, telegramUserId: adminTgUser },
      { userId: ownerId, chatId: ownerChat, telegramUserId: ownerTgUser }
    ])
  })

  afterAll(async () => {
    if (!client) return
    await client.db.delete(schema.auditLog).where(inArray(schema.auditLog.actorId, [adminId, ownerId]))
    await client.db.delete(schema.ideas).where(inArray(schema.ideas.authorId, [adminId, ownerId]))
    await client.db.delete(schema.telegramConversationMessages).where(inArray(schema.telegramConversationMessages.chatId, [adminChat, ownerChat]))
    await client.db.delete(schema.users).where(inArray(schema.users.id, [adminId, ownerId]))
    await client.pool.end()
  })

  function newIdeaAction(userId = adminId, chatId = adminChat) {
    return service.createPendingAction({
      chatId,
      userId,
      tool: 'crear_idea',
      input: { title: `Idea ${randomUUID()}`, description: 'Creada desde un test de Telegram' }
    })
  }

  async function ideasCount(title: string) {
    const rows = await client.db.select().from(schema.ideas).where(eq(schema.ideas.title, title))
    return rows.length
  }

  it('dos pulsaciones simultáneas ejecutan la acción una sola vez', async () => {
    const action = await newIdeaAction()
    const ctx = { actionId: action.id, chatId: adminChat, telegramUserId: adminTgUser }
    const outcomes = await Promise.all([service.confirmPendingAction(ctx), service.confirmPendingAction(ctx)])
    expect(outcomes.filter(outcome => outcome.ok)).toHaveLength(1)
    expect(await ideasCount((action.input as { title: string }).title)).toBe(1)

    const [row] = await client.db.select().from(schema.telegramPendingActions).where(eq(schema.telegramPendingActions.id, action.id))
    expect(row?.status).toBe('done')
  })

  it('una confirmación caducada no ejecuta nada', async () => {
    const action = await newIdeaAction()
    await client.db.update(schema.telegramPendingActions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.telegramPendingActions.id, action.id))
    const outcome = await service.confirmPendingAction({ actionId: action.id, chatId: adminChat, telegramUserId: adminTgUser })
    expect(outcome.ok).toBe(false)
    expect(outcome.text).toContain('caducado')
    expect(await ideasCount((action.input as { title: string }).title)).toBe(0)
  })

  it('rechaza la pulsación de otra cuenta de Telegram o desde otro chat', async () => {
    const action = await newIdeaAction()
    const fromOther = await service.confirmPendingAction({ actionId: action.id, chatId: adminChat, telegramUserId: ownerTgUser })
    const otherChat = await service.confirmPendingAction({ actionId: action.id, chatId: ownerChat, telegramUserId: ownerTgUser })
    expect(fromOther.ok).toBe(false)
    expect(otherChat.ok).toBe(false)
    expect(await ideasCount((action.input as { title: string }).title)).toBe(0)
  })

  it('un no-admin no puede confirmar aunque la acción sea suya', async () => {
    const action = await newIdeaAction(ownerId, ownerChat)
    const outcome = await service.confirmPendingAction({ actionId: action.id, chatId: ownerChat, telegramUserId: ownerTgUser })
    expect(outcome.ok).toBe(false)
    expect(await ideasCount((action.input as { title: string }).title)).toBe(0)
  })

  it('cancelar no cambia nada y deja la acción cerrada', async () => {
    const action = await newIdeaAction()
    const ctx = { actionId: action.id, chatId: adminChat, telegramUserId: adminTgUser }
    expect((await service.cancelPendingAction(ctx)).ok).toBe(true)
    expect((await service.confirmPendingAction(ctx)).ok).toBe(false)
    expect(await ideasCount((action.input as { title: string }).title)).toBe(0)
  })

  it('las ejecuciones huérfanas se marcan como fallidas al arrancar', async () => {
    const action = await newIdeaAction()
    await client.db.update(schema.telegramPendingActions)
      .set({ status: 'executing', executingAt: new Date() })
      .where(eq(schema.telegramPendingActions.id, action.id))
    // Una ejecución reciente puede seguir en curso en otra instancia: no se toca.
    expect((await service.failOrphanedExecutions()).some(item => item.chatId === adminChat)).toBe(false)
    const orphaned = await service.failOrphanedExecutions(0)
    expect(orphaned.some(item => item.chatId === adminChat)).toBe(true)
    const [row] = await client.db.select().from(schema.telegramPendingActions).where(eq(schema.telegramPendingActions.id, action.id))
    expect(row?.status).toBe('failed')
  })
})
