// Fechas «de hoy» y normalización de la fecha del ticket en el cliente. Mismo criterio que
// server/utils/madrid-date.ts: el día es el de la finca (Europe/Madrid), no el del navegador.

// 'YYYY-MM-DD' del día actual en Madrid.
export function todayInMadridClient(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(now)
}

// El OCR devuelve la fecha del ticket en ISO, pero a veces en formato español. Convierte
// DD/MM/YYYY (o DD-MM-YYYY) a ISO; si no es una fecha de calendario real, devuelve null y la
// pantalla se queda con la fecha por defecto (hoy).
export function parseTicketDate(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed)
  if (isoMatch) {
    const iso = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
    return isRealCalendarDate(iso) ? iso : null
  }

  const spanishMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed)
  if (spanishMatch) {
    const iso = `${spanishMatch[3]}-${spanishMatch[2]!.padStart(2, '0')}-${spanishMatch[1]!.padStart(2, '0')}`
    return isRealCalendarDate(iso) ? iso : null
  }

  return null
}

// Fecha de calendario real: el regex por sí solo deja pasar 2026-02-31.
export function isRealCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const parsed = new Date(`${date}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
}
