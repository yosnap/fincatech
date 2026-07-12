import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  // 'admin' | 'owner' | 'guest' — validado en la capa de aplicación (server/utils/rbac.ts),
  // no como pg enum, porque el plugin admin de Better Auth escribe este campo como string libre.
  role: text('role').notNull().default('guest'),
  // Soft-delete de miembros (baja) vía plugin admin de Better Auth (banUser/unbanUser).
  banned: boolean('banned').notNull().default(false),
  banReason: text('ban_reason'),
  banExpires: timestamp('ban_expires', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
})
