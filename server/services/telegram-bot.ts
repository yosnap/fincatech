import { getEnv } from '../utils/env'

export function isTelegramConfigured(): boolean {
  const env = getEnv()
  return !!env.TELEGRAM_BOT_TOKEN && !!env.TELEGRAM_WEBHOOK_SECRET
}

function apiUrl(method: string): string {
  const env = getEnv()
  return `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`
}

export async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  const response = await fetch(apiUrl('sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: false })
  })
  if (!response.ok) {
    throw new Error(`Telegram sendMessage falló: ${response.status}`)
  }
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
