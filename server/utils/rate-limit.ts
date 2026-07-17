// Rate limit en memoria, por proceso — suficiente porque la app ya está restringida a
// correr con una sola réplica (ver docs/deployment.md, mismo motivo que el
// notification-dispatcher usa estado en proceso). No sobrevive a un reinicio del
// contenedor, lo cual es aceptable: el objetivo es frenar scripts de abuso, no ser una
// defensa criptográficamente robusta.
const attempts = new Map<string, { count: number, resetAt: number }>()

export function checkRateLimit(key: string, opts: { max: number, windowMs: number }): boolean {
  const now = Date.now()
  const entry = attempts.get(key)
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + opts.windowMs })
    return true
  }
  if (entry.count >= opts.max) return false
  entry.count++
  return true
}
