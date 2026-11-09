import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { users } from './users'

// Acción de escritura propuesta por el agente de Telegram y pendiente de que el Admin pulse
// «Confirmar». Ciclo de vida: pending → executing → done | failed, o pending → cancelled /
// expired. La transición pending → executing es un UPDATE condicional (una sola ejecución
// aunque se pulse dos veces).
export const telegramPendingActions = pgTable('telegram_pending_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  chatId: text('chat_id').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tool: text('tool').notNull(),
  input: jsonb('input').notNull(),
  summary: text('summary').notNull(),
  // 'pending' | 'executing' | 'done' | 'failed' | 'cancelled' | 'expired'
  status: text('status').notNull().default('pending'),
  result: jsonb('result'),
  error: text('error'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  // Momento en que pasó a `executing`: la recuperación solo cierra las que llevan colgadas
  // más de unos minutos (un despliegue con solapamiento no debe cerrar una en curso).
  executingAt: timestamp('executing_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true })
}, table => [index('telegram_pending_actions_status_idx').on(table.status)])

// Memoria corta del agente por chat (últimos mensajes). `content` es el texto del turno; las
// llamadas a herramientas intermedias no se guardan, solo el diálogo visible y los resultados
// de confirmaciones como mensajes sintéticos.
export const telegramConversationMessages = pgTable('telegram_conversation_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  chatId: text('chat_id').notNull(),
  // 'user' | 'assistant'
  role: text('role').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => [index('telegram_conversation_messages_chat_idx').on(table.chatId, table.createdAt)])

// Ajustes del asistente IA editables por el Admin desde la web (una única fila, id = 'global').
// Cada campo nulo cae a su variable de entorno. La clave del proveedor se guarda cifrada
// (AES-256-GCM con una clave derivada de BETTER_AUTH_SECRET) y nunca se devuelve al cliente.
export const aiAgentSettings = pgTable('ai_agent_settings', {
  id: text('id').primaryKey(),
  enabled: boolean('enabled').notNull().default(true),
  baseUrl: text('base_url'),
  model: text('model'),
  apiKeyCiphertext: text('api_key_ciphertext'),
  // Últimos 4 caracteres de la clave, para que el Admin reconozca cuál hay guardada.
  apiKeyHint: text('api_key_hint'),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
})
