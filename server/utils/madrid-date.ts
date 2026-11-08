// Fechas «de hoy» en la zona horaria de la finca (Europe/Madrid). Un único sitio para que el
// gasto, el cargo de la hipoteca y el OCR coincidan en qué día es «hoy» — el contenedor corre
// en UTC y a partir de las 00:00 de Madrid (23:00 UTC del día anterior) un `new Date()` ingenuo
// fecharía el gasto en el día equivocado.

// 'YYYY-MM-DD' del día actual en Madrid. `now` inyectable para testear el cron y los flujos
// que dependen de la fecha sin esperar al reloj real.
export function todayInMadrid(now: Date = new Date()): string {
  // 'en-CA' produce directamente el formato ISO 'YYYY-MM-DD'.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(now)
}

// Día de Madrid ('YYYY-MM-DD') de una fecha/hora concreta: se usa para derivar la fecha del
// gasto a partir de `createdAt` sin depender de la zona del proceso.
export function madridDateOf(value: Date): string {
  return todayInMadrid(value)
}

// Un gasto no puede llevar fecha futura (sería un error de tecleo o de OCR).
export function isFutureMadridDate(date: string, now: Date = new Date()): boolean {
  return date > todayInMadrid(now)
}
