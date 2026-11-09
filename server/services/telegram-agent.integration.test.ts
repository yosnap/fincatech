import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { describeDb, setupIntegrationDb } from '../test/integration-db'

// Bucle del agente contra Postgres REAL con el modelo y la API de Telegram simulados: una
// lectura se ejecuta y vuelve al modelo; una escritura NO se ejecuta, se convierte en acción
// pendiente con botones.
const sent: { chatId: string, text: string, buttons?: unknown }[] = []
vi.mock('./telegram-bot', () => ({
  sendTelegramMessage: vi.fn(async (chatId: string, text: string, options?: { buttons?: unknown }) => {
    sent.push({ chatId, text, buttons: options?.buttons })
    return 1
  }),
  sendTelegramTyping: vi.fn(async () => {})
}))

const scripted: unknown[] = []
vi.mock('./ai-chat-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('./ai-chat-client')>()
  return {
    ...original,
    isAgentConfigured: () => true,
    chatCompletion: vi.fn(async () => scripted.shift())
  }
})

describeDb('agente de Telegram — bucle de herramientas', () => {
  const adminId = `tg-agent-${randomUUID()}`
  const chatId = `5${Date.now()}`
  const title = `Idea del agente ${randomUUID()}`
  let client: Awaited<ReturnType<typeof setupIntegrationDb>>
  let schema: Awaited<ReturnType<typeof setupIntegrationDb>>['schema']
  let agent: typeof import('./telegram-agent')

  beforeAll(async () => {
    client = await setupIntegrationDb()
    schema = client.schema
    agent = await import('./telegram-agent')
    await client.db.insert(schema.users).values({ id: adminId, name: 'Agente Admin', email: `${adminId}@example.test`, role: 'admin' })
  })

  afterAll(async () => {
    if (!client) return
    await client.db.delete(schema.telegramConversationMessages).where(eq(schema.telegramConversationMessages.chatId, chatId))
    await client.db.delete(schema.users).where(eq(schema.users.id, adminId))
    await client.pool.end()
  })

  it('lee directamente y deja la escritura pendiente de confirmación', async () => {
    scripted.push(
      { message: { content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'listar_ideas', arguments: '{}' } }] } },
      { message: { content: null, tool_calls: [{ id: 't2', type: 'function', function: { name: 'crear_idea', arguments: JSON.stringify({ title, description: 'Propuesta por el agente' }) } }] } },
      { message: { content: 'Te he dejado la idea para que la confirmes. Detalles: https://evil.example/x' } }
    )

    await agent.handleAgentMessage({ id: adminId, role: 'admin', banned: false }, chatId, 'Apunta una idea nueva')

    const ideas = await client.db.select().from(schema.ideas).where(eq(schema.ideas.title, title))
    expect(ideas).toHaveLength(0)

    const [pending] = await client.db.select().from(schema.telegramPendingActions).where(eq(schema.telegramPendingActions.chatId, chatId))
    expect(pending?.tool).toBe('crear_idea')
    expect(pending?.status).toBe('pending')

    const confirmation = sent.find(message => message.buttons)
    expect(confirmation?.text).toContain('crear_idea')
    const reply = sent.at(-1)
    expect(reply?.text).toContain('[enlace omitido]')

    const history = await client.db.select().from(schema.telegramConversationMessages).where(eq(schema.telegramConversationMessages.chatId, chatId))
    expect(history.map(row => row.role).sort()).toEqual(['assistant', 'user'])
  })
})
