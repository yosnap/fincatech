import { and, eq, lt } from 'drizzle-orm'
import { db } from '../db/client'
import { notificationPreferences, notificationsOutbox, telegramLinks } from '../db/schema'
import { sendEmail } from '../utils/email'
import { isTelegramConfigured, sendTelegramMessage } from './telegram-bot'

export type NotificationChannel = 'telegram' | 'email'

interface EnqueueInput {
  userId: string
  eventType: string
  subject: string
  body: string
}

type Inserter = Pick<typeof db, 'insert' | 'select'>

// Escribe en notifications_outbox dentro de la MISMA transacción que el evento de dominio
// (p.ej. expense-service.createExpense) — nunca bloquea esa transacción con una llamada de
// red real; el envío lo hace el dispatcher por separado (server/plugins/notification-dispatcher.ts).
export async function enqueueNotification(input: EnqueueInput, executor: Inserter = db) {
  const prefs = await executor.select().from(notificationPreferences).where(eq(notificationPreferences.userId, input.userId))
  const pref = prefs[0]
  // Por defecto: email activado, telegram desactivado (coincide con el default de la columna
  // si el usuario nunca guardó preferencias explícitas en /profile).
  const emailEnabled = pref?.emailEnabled ?? true
  const telegramEnabled = pref?.telegramEnabled ?? false

  const channels: NotificationChannel[] = []
  if (emailEnabled) channels.push('email')
  if (telegramEnabled) channels.push('telegram')

  if (channels.length === 0) return

  await executor.insert(notificationsOutbox).values(
    channels.map(channel => ({
      userId: input.userId,
      channel,
      eventType: input.eventType,
      payload: { subject: input.subject, body: input.body }
    }))
  )
}

const MAX_ATTEMPTS = 5

// Vacía el outbox: envía lo pendiente, marca 'sent', 'failed' (agotados los intentos) o
// reprograma con 'pending' (habrá más intentos). No hay backoff creciente real: el intervalo
// fijo del cron (30s) actúa como único espaciado entre reintentos — suficiente para el
// volumen esperado (familia, pocos eventos/día), pero es una simplificación deliberada
// frente a lo que pedía el plan original ("reintento con backoff").
export async function dispatchPendingNotifications(): Promise<{ sent: number, failed: number }> {
  // Reclamo atómico vía UPDATE...RETURNING: si dos dispatchers corrieran a la vez (o un tick
  // se solapa con el anterior porque el envío tardó más de 30s), cada fila solo puede ser
  // "ganada" por una llamada — la otra ya no la ve en estado 'pending'. Evita reenviar la
  // misma notificación dos veces.
  const claimed = await db.update(notificationsOutbox)
    .set({ status: 'sending' })
    .where(and(eq(notificationsOutbox.status, 'pending'), lt(notificationsOutbox.attempts, MAX_ATTEMPTS)))
    .returning()

  let sent = 0
  let failed = 0

  for (const item of claimed) {
    try {
      const payload = item.payload as { subject: string, body: string }
      if (item.channel === 'email') {
        await sendEmailNotification(item.userId, payload)
      } else if (item.channel === 'telegram') {
        await sendTelegramNotification(item.userId, payload)
      }
      await db.update(notificationsOutbox)
        .set({ status: 'sent', sentAt: new Date() })
        .where(eq(notificationsOutbox.id, item.id))
      sent++
    } catch (error) {
      const attempts = item.attempts + 1
      await db.update(notificationsOutbox)
        .set({
          status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
          attempts,
          lastError: String(error)
        })
        .where(eq(notificationsOutbox.id, item.id))
      failed++
    }
  }

  return { sent, failed }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function sendEmailNotification(userId: string, payload: { subject: string, body: string }) {
  const user = await db.query.users.findFirst({ where: (u, { eq: eqOp }) => eqOp(u.id, userId) })
  if (!user) throw new Error(`Usuario ${userId} no encontrado`)
  // payload.body puede contener texto libre escrito por un admin/owner (p.ej. la descripción
  // de un gasto) — se escapa antes de interpolar en HTML para evitar inyección.
  await sendEmail(user.email, payload.subject, `<p>${escapeHtml(payload.body)}</p>`)
}

async function sendTelegramNotification(userId: string, payload: { subject: string, body: string }) {
  if (!isTelegramConfigured()) throw new Error('Telegram no configurado')
  const link = await db.query.telegramLinks.findFirst({ where: eq(telegramLinks.userId, userId) })
  if (!link) throw new Error(`Usuario ${userId} no tiene Telegram vinculado`)
  await sendTelegramMessage(link.chatId, `${payload.subject}\n\n${payload.body}`)
}
