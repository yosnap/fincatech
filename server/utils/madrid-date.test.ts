import { describe, expect, it } from 'vitest'
import { isFutureMadridDate, madridDateOf, todayInMadrid } from './madrid-date'

describe('todayInMadrid', () => {
  it('usa la zona horaria de la finca (un UTC de las 23:00 ya es el día siguiente en Madrid)', () => {
    expect(todayInMadrid(new Date('2026-11-08T22:30:00Z'))).toBe('2026-11-08')
    expect(todayInMadrid(new Date('2026-11-08T23:30:00Z'))).toBe('2026-11-09')
  })

  it('cruza bien el cambio de horario (verano UTC+2, invierno UTC+1)', () => {
    // 2026-07-01 22:30 UTC = 00:30 del 2 de julio en Madrid (CEST, UTC+2).
    expect(todayInMadrid(new Date('2026-07-01T22:30:00Z'))).toBe('2026-07-02')
    // 2026-01-01 22:30 UTC = 23:30 del 1 de enero en Madrid (CET, UTC+1).
    expect(todayInMadrid(new Date('2026-01-01T22:30:00Z'))).toBe('2026-01-01')
  })
})

describe('madridDateOf', () => {
  it('deriva el día de Madrid de una marca de tiempo', () => {
    expect(madridDateOf(new Date('2026-11-08T23:15:00Z'))).toBe('2026-11-09')
  })
})

describe('isFutureMadridDate', () => {
  const now = new Date('2026-11-08T10:00:00Z')

  it('detecta fechas futuras y acepta hoy y el pasado', () => {
    expect(isFutureMadridDate('2026-11-09', now)).toBe(true)
    expect(isFutureMadridDate('2026-11-08', now)).toBe(false)
    expect(isFutureMadridDate('2026-10-31', now)).toBe(false)
  })
})
