import { integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { users } from './users'

// 'new' | 'discussion' | 'promoted' | 'discarded' — validado en la capa de aplicación.
export const ideas = pgTable('ideas', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  authorId: text('author_id').notNull().references(() => users.id),
  status: text('status').notNull().default('new'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
})

export const ideaComments = pgTable('idea_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  ideaId: uuid('idea_id').notNull().references(() => ideas.id, { onDelete: 'cascade' }),
  authorId: text('author_id').notNull().references(() => users.id),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})

// 'voting' | 'approved' — validado en la capa de aplicación.
export const proposals = pgTable('proposals', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  authorId: text('author_id').notNull().references(() => users.id),
  // Nullable: una propuesta puede nacer directamente, sin pasar por Ideas (PRD §4.3).
  originIdeaId: uuid('origin_idea_id').references(() => ideas.id),
  status: text('status').notNull().default('voting'),
  // Sin FK real a quotes.id a propósito: proposals<->quotes serían referencias circulares
  // (quotes.proposalId -> proposals.id). Se valida en la capa de aplicación que el id
  // pertenezca a una quote de esta misma propuesta antes de fijarlo (proposal-service.ts).
  winningQuoteId: uuid('winning_quote_id'),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  closedBy: text('closed_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
})

export const quotes = pgTable('quotes', {
  id: uuid('id').primaryKey().defaultRandom(),
  proposalId: uuid('proposal_id').notNull().references(() => proposals.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  priceCents: integer('price_cents').notNull(),
  conditions: text('conditions'),
  attachmentObjectName: text('attachment_object_name'),
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})

export const votes = pgTable('votes', {
  id: uuid('id').primaryKey().defaultRandom(),
  proposalId: uuid('proposal_id').notNull().references(() => proposals.id, { onDelete: 'cascade' }),
  quoteId: uuid('quote_id').notNull().references(() => quotes.id, { onDelete: 'cascade' }),
  voterId: text('voter_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => [
  // Un propietario = un voto por propuesta (Success Criterion de la Fase 6).
  unique('votes_voter_proposal_unique').on(table.voterId, table.proposalId)
])
