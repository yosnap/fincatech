import { getEnv } from '../utils/env'

export function isTelegramConfigured(): boolean {
  const env = getEnv()
  return !!env.TELEGRAM_BOT_TOKEN && !!env.TELEGRAM_WEBHOOK_SECRET
}

function apiUrl(method: string): string {
  const env = getEnv()
  return `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`
}

// Telegram limita un mensaje a 4096 caracteres; se trocea con margen.
export const TELEGRAM_CHUNK_SIZE = 4000

export interface InlineButton {
  text: string
  callback_data: string
}

export interface SendMessageOptions {
  // Teclado inline (filas de botones) para confirmaciones.
  buttons?: InlineButton[][]
}

async function callTelegram<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(apiUrl(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000)
  })
  const json = await response.json().catch(() => ({})) as { ok?: boolean, result?: T, description?: string }
  if (!response.ok || !json.ok) {
    throw new Error(`Telegram ${method} falló: ${response.status} ${json.description ?? ''}`.trim())
  }
  return json.result as T
}

// Parte un texto largo en bloques <= TELEGRAM_CHUNK_SIZE, cortando preferentemente en un salto
// de línea para no partir frases.
export function chunkTelegramText(text: string, size = TELEGRAM_CHUNK_SIZE): string[] {
  const chunks: string[] = []
  let rest = text
  while (rest.length > size) {
    const cut = rest.lastIndexOf('\n', size)
    const at = cut > size / 2 ? cut : size
    chunks.push(rest.slice(0, at))
    rest = rest.slice(at).replace(/^\n/, '')
  }
  if (rest.length > 0 || chunks.length === 0) chunks.push(rest)
  return chunks
}

// Envía texto PLANO (sin parse_mode: el texto del modelo o de los datos nunca se interpreta
// como formato) y sin vista previa de enlaces. Los botones van en el último bloque. Devuelve
// el message_id del último mensaje enviado.
export async function sendTelegramMessage(chatId: string, text: string, options: SendMessageOptions = {}): Promise<number | undefined> {
  const chunks = chunkTelegramText(text)
  let lastId: number | undefined
  for (const [index, chunk] of chunks.entries()) {
    const isLast = index === chunks.length - 1
    const result = await callTelegram<{ message_id: number }>('sendMessage', {
      chat_id: chatId,
      text: chunk,
      link_preview_options: { is_disabled: true },
      ...(isLast && options.buttons ? { reply_markup: { inline_keyboard: options.buttons } } : {})
    })
    lastId = result.message_id
  }
  return lastId
}

// Edita un mensaje ya enviado (resultado de una confirmación) y le quita los botones.
export async function editTelegramMessage(chatId: string, messageId: number, text: string): Promise<void> {
  await callTelegram('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: chunkTelegramText(text)[0],
    link_preview_options: { is_disabled: true },
    reply_markup: { inline_keyboard: [] }
  })
}

// Obligatorio tras cada pulsación de botón: si no, el cliente deja el botón «cargando».
export async function answerTelegramCallback(callbackQueryId: string, text?: string): Promise<void> {
  await callTelegram('answerCallbackQuery', { callback_query_id: callbackQueryId, ...(text ? { text } : {}) })
}

// Muestra «escribiendo…» en el chat (dura unos 5 s o hasta el siguiente mensaje).
export async function sendTelegramTyping(chatId: string): Promise<void> {
  await callTelegram('sendChatAction', { chat_id: chatId, action: 'typing' })
}

// Descarga un archivo de Telegram por file_id: primero resuelve la ruta (getFile), luego
// descarga el binario desde el CDN de archivos (host distinto al de la API normal).
export async function downloadTelegramFile(fileId: string): Promise<{ buffer: Buffer, contentType: string }> {
  const env = getEnv()
  const fileInfoResponse = await fetch(apiUrl('getFile') + `?file_id=${encodeURIComponent(fileId)}`)
  if (!fileInfoResponse.ok) {
    throw new Error(`Telegram getFile falló: ${fileInfoResponse.status}`)
  }
  const fileInfo = await fileInfoResponse.json() as { result?: { file_path?: string } }
  const filePath = fileInfo.result?.file_path
  if (!filePath) {
    throw new Error('Telegram getFile no devolvió file_path')
  }

  const fileResponse = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`)
  if (!fileResponse.ok) {
    throw new Error(`Descarga de archivo de Telegram falló: ${fileResponse.status}`)
  }
  const arrayBuffer = await fileResponse.arrayBuffer()
  const extension = filePath.split('.').pop()?.toLowerCase()
  const contentType = extension === 'png' ? 'image/png' : 'image/jpeg'
  return { buffer: Buffer.from(arrayBuffer), contentType }
}
