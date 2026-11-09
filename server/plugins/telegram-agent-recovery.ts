import { failOrphanedExecutions } from '../services/telegram-confirmations'
import { isTelegramConfigured, sendTelegramMessage } from '../services/telegram-bot'

const CHECK_INTERVAL_MS = 10 * 60 * 1000

// Las acciones confirmadas que quedaron a medias (`executing` desde hace minutos, p. ej. por un
// reinicio) pasan a `failed` y se avisa al chat para que el admin revise el resultado en la
// web. Se revisa al arrancar y cada 10 minutos.
async function recoverOrphanedExecutions() {
  try {
    const orphaned = await failOrphanedExecutions()
    if (orphaned.length === 0 || !isTelegramConfigured()) return
    for (const action of orphaned) {
      await sendTelegramMessage(
        action.chatId,
        `Una acción confirmada se interrumpió y no sé si llegó a aplicarse. Revísalo en la web:\n${action.summary}`
      ).catch(() => {})
    }
  } catch (error) {
    console.error('[telegram-agent-recovery] fallo al revisar acciones huérfanas', error)
  }
}

export default defineNitroPlugin(() => {
  if (import.meta.prerender) return
  void recoverOrphanedExecutions()
  setInterval(() => void recoverOrphanedExecutions(), CHECK_INTERVAL_MS).unref()
})
