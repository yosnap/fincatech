import { randomUUID, timingSafeEqual } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { telegramLinkTokens, telegramLinks, telegramProcessedUpdates } from '../../db/schema'
import { uploadFile } from '../../services/storage'
import { downloadTelegramFile, isTelegramConfigured, sendTelegramMessage } from '../../services/telegram-bot'
import { extractReceiptData, isOcrConfigured } from '../../services/vision-ocr'
import { getEnv } from '../../utils/env'

interface TelegramPhotoSize {
  file_id: string
  file_size?: number
}

interface TelegramUpdate {
  update_id: number
  message?: {
    chat: { id: number }
    text?: string
    photo?: TelegramPhotoSize[]
  }
}

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

  const message = update.message
  const chatId = message?.chat?.id != null ? String(message.chat.id) : undefined
  if (!chatId) {
    return { ok: true }
  }

  // A partir de aquí el update_id YA quedó marcado como procesado (dedupe de arriba): si algo
  // falla (p.ej. la propia API de Telegram no responde al intentar contestar), Telegram no
  // reintentará este update — así que nunca dejamos que un error escape como 500 y perdamos
  // la respuesta al usuario sin posibilidad de recuperación. Solo se loguea.
  try {
    if (message?.text?.startsWith('/link ')) {
      await handleLinkCommand(chatId, message.text.slice('/link '.length).trim())
    } else if (message?.photo && message.photo.length > 0) {
      await handlePhoto(chatId, message.photo)
    } else {
      await sendTelegramMessage(chatId, 'Envía /link TOKEN para vincular tu cuenta (genera el token desde tu perfil en la web), o mándame una foto de un ticket.')
    }
  } catch (error) {
    console.error('[webhook/telegram] fallo procesando update', updateId, error)
  }

  return { ok: true }
})

function isValidWebhookSecret(received: string, expected: string): boolean {
  const receivedBuf = Buffer.from(received)
  const expectedBuf = Buffer.from(expected)
  if (receivedBuf.length !== expectedBuf.length) return false
  return timingSafeEqual(receivedBuf, expectedBuf)
}

async function handleLinkCommand(chatId: string, token: string) {
  const linkToken = await db.query.telegramLinkTokens.findFirst({ where: eq(telegramLinkTokens.token, token) })
  if (!linkToken || linkToken.usedAt || linkToken.expiresAt < new Date()) {
    await sendTelegramMessage(chatId, 'Token de vinculación inválido o caducado. Genera uno nuevo desde tu perfil en la web.')
    return
  }

  await db.transaction(async (tx) => {
    await tx.insert(telegramLinks)
      .values({ userId: linkToken.userId, chatId })
      .onConflictDoUpdate({ target: telegramLinks.userId, set: { chatId, linkedAt: new Date() } })
    await tx.update(telegramLinkTokens).set({ usedAt: new Date() }).where(eq(telegramLinkTokens.id, linkToken.id))
  })

  await sendTelegramMessage(chatId, '¡Cuenta vinculada! Ya puedes enviarme fotos de tickets para registrarlos.')
}

async function handlePhoto(chatId: string, photo: TelegramPhotoSize[]) {
  const link = await db.query.telegramLinks.findFirst({ where: eq(telegramLinks.chatId, chatId) })
  if (!link) {
    await sendTelegramMessage(chatId, 'Tu cuenta de Telegram no está vinculada. Envía /link TOKEN primero (genera el token desde tu perfil en la web).')
    return
  }

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
