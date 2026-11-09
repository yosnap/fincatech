import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
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
