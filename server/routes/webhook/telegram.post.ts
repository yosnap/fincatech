import { randomUUID, timingSafeEqual } from 'node:crypto'
import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm'
import { db } from '../../db/client'
import { telegramLinkTokens, telegramLinks, telegramProcessedUpdates, users } from '../../db/schema'
import { uploadFile } from '../../services/storage'
import { handleAgentMessage, resetConversation } from '../../services/telegram-agent'
import {
  answerTelegramCallback,
  downloadTelegramFile,
  editTelegramMessage,
  isTelegramConfigured,
  sendTelegramMessage
} from '../../services/telegram-bot'
import { cancelPendingAction, confirmPendingAction } from '../../services/telegram-confirmations'
import { extractReceiptData, isOcrConfigured } from '../../services/vision-ocr'
import { getEnv } from '../../utils/env'
import { hashLinkToken } from '../../utils/telegram-link-token'

interface TelegramPhotoSize {
  file_id: string
  file_size?: number
}

interface TelegramChat {
  id: number
  type: string
}

interface TelegramFrom {
  id: number
  username?: string
}

interface TelegramUpdate {
  update_id: number
  message?: {
    chat: TelegramChat
    from?: TelegramFrom
    text?: string
    photo?: TelegramPhotoSize[]
  }
  callback_query?: {
    id: string
    from: TelegramFrom
    data?: string
    message?: { message_id: number, chat: TelegramChat }
  }
}

const PRIVATE_ONLY_MESSAGE = 'Este bot solo funciona en chat privado.'
const RELINK_MESSAGE = 'Tu cuenta de Telegram no está vinculada (o hay que volver a vincularla). Envía /link TOKEN (genera el token desde tu perfil en la web).'

// Público a propósito (Telegram lo llama sin cookie de sesión) — la autenticación es el
// secret_token del header, validado abajo. Nunca confiar en el payload sin verificarlo primero.
export default defineEventHandler(async (event) => {
  if (!isTelegramConfigured()) {
    throw createError({ statusCode: 503, statusMessage: 'Bot de Telegram no configurado' })
  }

  const secretHeader = getHeader(event, 'x-telegram-bot-api-secret-token')
  if (!secretHeader || !isValidWebhookSecret(secretHeader, getEnv().TELEGRAM_WEBHOOK_SECRET!)) {
    throw createError({ statusCode: 401, statusMessage: 'Secret de webhook inválido' })
  }

  const update = await readBody<TelegramUpdate>(event)
  const updateId = String(update.update_id)

  // Dedupe: Telegram reintenta el mismo update_id si no respondemos 200 a tiempo. El insert
  // con onConflictDoNothing es atómico: si ya existe, devolvemos 200 sin reprocesar.
  const inserted = await db.insert(telegramProcessedUpdates).values({ updateId }).onConflictDoNothing().returning()
  if (inserted.length === 0) {
    return { ok: true }
  }

  // A partir de aquí el update_id YA quedó marcado como procesado: si algo falla, Telegram no
  // reintentará, así que nunca dejamos escapar un 500. Solo se loguea.
  try {
    if (update.callback_query) {
      await handleCallback(update.callback_query)
    } else if (update.message) {
      await handleMessage(update.message)
    }
  } catch (error) {
    console.error('[webhook/telegram] fallo procesando update', updateId, error)
    // Telegram no reintentará: se avisa al chat (solo privado) para que no quede sin respuesta.
    const chat = update.callback_query?.message?.chat ?? update.message?.chat
    if (chat?.type === 'private') {
      await sendTelegramMessage(String(chat.id), 'Algo ha fallado al procesar tu mensaje. Inténtalo de nuevo en un momento.').catch(() => {})
    }
  }

  return { ok: true }
})

function isValidWebhookSecret(received: string, expected: string): boolean {
  const receivedBuf = Buffer.from(received)
  const expectedBuf = Buffer.from(expected)
  if (receivedBuf.length !== expectedBuf.length) return false
  return timingSafeEqual(receivedBuf, expectedBuf)
}

async function handleMessage(message: NonNullable<TelegramUpdate['message']>) {
  const chatId = String(message.chat.id)
  // Solo chat privado: en un grupo cualquiera del grupo podría hablar con el bot del admin.
  if (message.chat.type !== 'private') {
    await sendTelegramMessage(chatId, PRIVATE_ONLY_MESSAGE)
    return
  }
  if (!message.from) return
  const fromId = String(message.from.id)
  const text = message.text?.trim()

  if (text?.startsWith('/link')) {
    await handleLinkCommand(chatId, message.from, text.slice('/link'.length).trim())
    return
  }

  const link = await db.query.telegramLinks.findFirst({ where: eq(telegramLinks.chatId, chatId) })
  if (!link || link.telegramUserId !== fromId) {
    await sendTelegramMessage(chatId, RELINK_MESSAGE)
    return
  }

  if (message.photo && message.photo.length > 0) {
    await handlePhoto(chatId, message.photo)
    return
  }

  if (!text) return

  const [user] = await db
    .select({ id: users.id, role: users.role, banned: users.banned, pendingApproval: users.pendingApproval })
    .from(users)
    .where(eq(users.id, link.userId))
  const isActiveAdmin = user && user.role === 'admin' && !user.banned && !user.pendingApproval
  if (!isActiveAdmin) {
    await sendTelegramMessage(chatId, 'El asistente de este bot solo está disponible para administradores. Puedes enviarme fotos de tickets para registrarlos.')
    return
  }

  if (text === '/start' || text === '/ayuda') {
    await sendTelegramMessage(chatId, 'Pregúntame lo que necesites de la finca: banco, aportes, gastos, tareas, ideas o reservas. Antes de cambiar nada te pediré confirmación. Envía /nuevo para empezar una conversación desde cero.')
    return
  }
  if (text === '/nuevo') {
    await resetConversation(chatId)
    await sendTelegramMessage(chatId, 'Conversación reiniciada.')
    return
  }

  // Sin await: Telegram necesita el 200 enseguida; el agente contesta en segundo plano.
  void handleAgentMessage({ id: user.id, role: user.role, banned: Boolean(user.banned) }, chatId, text)
}

async function handleCallback(callback: NonNullable<TelegramUpdate['callback_query']>) {
  const chat = callback.message?.chat
  const messageId = callback.message?.message_id
  if (!chat || messageId == null) {
    await answerTelegramCallback(callback.id).catch(() => {})
    return
  }
  if (chat.type !== 'private') {
    await answerTelegramCallback(callback.id, PRIVATE_ONLY_MESSAGE).catch(() => {})
    return
  }

  const match = /^([cx]):([0-9a-f-]{36})$/.exec(callback.data ?? '')
  if (!match) {
    await answerTelegramCallback(callback.id).catch(() => {})
    return
  }
  const ctx = { actionId: match[2]!, chatId: String(chat.id), telegramUserId: String(callback.from.id) }

  // Responder al callback es cosmético: si falla, la confirmación sigue adelante.
  await answerTelegramCallback(callback.id, match[1] === 'c' ? 'Ejecutando…' : 'Cancelando…').catch(() => {})
  const outcome = match[1] === 'c' ? await confirmPendingAction(ctx) : await cancelPendingAction(ctx)
  try {
    await editTelegramMessage(ctx.chatId, messageId, outcome.text)
  } catch (error) {
    console.error('[webhook/telegram] no se pudo editar el mensaje de confirmación', error)
    await sendTelegramMessage(ctx.chatId, outcome.text)
  }
}

async function handleLinkCommand(chatId: string, from: TelegramFrom, token: string) {
  if (!token) {
    await sendTelegramMessage(chatId, 'Envía /link TOKEN (genera el token desde tu perfil en la web).')
    return
  }

  // Consumo atómico: solo una petición puede marcar el token como usado.
  const [linkToken] = await db.update(telegramLinkTokens)
    .set({ usedAt: new Date() })
    .where(and(
      eq(telegramLinkTokens.token, hashLinkToken(token)),
      isNull(telegramLinkTokens.usedAt),
      gt(telegramLinkTokens.expiresAt, sql`now()`)
    ))
    .returning()
  if (!linkToken) {
    await sendTelegramMessage(chatId, 'Token de vinculación inválido o caducado. Genera uno nuevo desde tu perfil en la web.')
    return
  }

  const previous = await db.query.telegramLinks.findFirst({ where: eq(telegramLinks.userId, linkToken.userId) })
  await db.transaction(async (tx) => {
    // Este chat pasa a ser de este usuario aunque antes estuviera vinculado a otro.
    await tx.delete(telegramLinks).where(and(eq(telegramLinks.chatId, chatId), ne(telegramLinks.userId, linkToken.userId)))
    const values = {
      chatId,
      telegramUserId: String(from.id),
      telegramUsername: from.username ?? null,
      linkedAt: new Date()
    }
    await tx.insert(telegramLinks)
      .values({ userId: linkToken.userId, ...values })
      .onConflictDoUpdate({ target: telegramLinks.userId, set: values })
  })

  if (previous && previous.chatId !== chatId) {
    await sendTelegramMessage(previous.chatId, 'Tu cuenta de FincaTech se ha vinculado a otro chat de Telegram. Este chat ya no está vinculado.').catch(() => {})
  }
  await sendTelegramMessage(chatId, '¡Cuenta vinculada! Ya puedes enviarme fotos de tickets para registrarlos.')
}

async function handlePhoto(chatId: string, photo: TelegramPhotoSize[]) {
  if (!isOcrConfigured()) {
    await sendTelegramMessage(chatId, 'El OCR no está disponible ahora mismo. Registra el gasto manualmente en la web.')
    return
  }

  // Telegram ordena las miniaturas de menor a mayor resolución; la última es la más grande.
  const largest = photo[photo.length - 1]
  if (!largest) {
    return
  }

  try {
    const { buffer, contentType } = await downloadTelegramFile(largest.file_id)
    const extension = contentType === 'image/png' ? 'png' : 'jpg'
    const objectName = `expenses/telegram/${randomUUID()}.${extension}`
    await uploadFile(objectName, buffer, contentType)

    const result = await extractReceiptData(buffer.toString('base64'), contentType)

    const draft = Buffer.from(JSON.stringify({
      objectName,
      contentType,
      extraction: result.extraction,
      costUsd: result.costUsd
    })).toString('base64url')

    const url = new URL('/expenses/from-telegram', getEnv().BETTER_AUTH_URL)
    url.searchParams.set('data', draft)
    await sendTelegramMessage(chatId, `Ticket recibido. Revisa y confirma el gasto aquí:\n${url.toString()}`)
  } catch (error) {
    console.error('[webhook/telegram] fallo procesando foto', error)
    await sendTelegramMessage(chatId, 'No se pudo procesar la foto. Intenta de nuevo o registra el gasto manualmente en la web.')
  }
}
