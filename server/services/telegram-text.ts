// Saneado del texto que el bot envía a Telegram (respuestas del modelo y resúmenes de
// acciones). Telegram convierte en enlace pulsable tanto `https://…` como un dominio suelto
// (`evil.com/x`, `t.me/…`), así que se neutralizan ambos salvo los de la propia app: toda URL
// con esquema, y los dominios sueltos con un TLD habitual (sin esquema no hay forma fiable de
// distinguir un dominio de un nombre de fichero como `factura.pdf`).

const URL_PATTERN = /https?:\/\/[^\s)]+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|me|es|app|dev|co|ru|xyz|info|biz|ly|link|site|online|top|cc|tk|gl|to|ai|eu|uk|de|fr|sh|gg|tv|ws|su|cn|in|us)\b(?:[/?#][^\s),;]*)?/gi

export function sanitizeAgentReply(text: string, appUrl: string): string {
  const appHost = new URL(appUrl).host.toLowerCase()
  return text.replace(URL_PATTERN, (match) => {
    try {
      const url = new URL(/^https?:\/\//i.test(match) ? match : `https://${match}`)
      return url.host.toLowerCase() === appHost ? match : '[enlace omitido]'
    } catch {
      return '[enlace omitido]'
    }
  }).trim()
}
