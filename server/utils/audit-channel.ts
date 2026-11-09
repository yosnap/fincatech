import { AsyncLocalStorage } from 'node:async_hooks'

// Canal de la operación (fase 4, RT-5): permite saber si un cambio se hizo desde la web, el
// servidor MCP, el bot de Telegram o un cron — sin tener que ir pasando un parámetro extra por
// todos los servicios. `runWithChannel` envuelve la ejecución y `writeAuditLog` lo lee.
export type AuditChannel = 'web' | 'mcp' | 'telegram' | 'system'

const storage = new AsyncLocalStorage<{ channel: AuditChannel }>()

export function runWithChannel<T>(channel: AuditChannel, fn: () => T): T {
  return storage.run({ channel }, fn)
}

// `web` por defecto: una petición normal de la app nunca ambienta canal.
export function currentChannel(): AuditChannel {
  return storage.getStore()?.channel ?? 'web'
}
