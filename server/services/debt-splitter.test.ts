import { describe, expect, it } from 'vitest'
import { splitExpense } from './debt-splitter'

function participants(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `user-${i}`)
}

describe('splitExpense', () => {
  it('lanza si no hay participantes', () => {
    expect(() => splitExpense(1000, [])).toThrow()
  })

  it('lanza con importes no enteros o negativos', () => {
    expect(() => splitExpense(10.5, ['a'])).toThrow()
    expect(() => splitExpense(-100, ['a'])).toThrow()
  })

  it('un solo participante se lleva el importe completo', () => {
    const shares = splitExpense(12345, ['a'])
    expect(shares).toEqual([{ userId: 'a', amountCents: 12345 }])
  })

  it('división exacta sin residuo (N=2, importe par)', () => {
    const shares = splitExpense(10000, participants(2))
    expect(shares.map(s => s.amountCents)).toEqual([5000, 5000])
  })

  it('importe indivisible: el residuo va al último participante (orden por userId)', () => {
    // 10001 / 3 = 3333 resto 2
    const shares = splitExpense(10001, ['user-2', 'user-0', 'user-1'])
    expect(shares).toEqual([
      { userId: 'user-0', amountCents: 3333 },
      { userId: 'user-1', amountCents: 3333 },
      { userId: 'user-2', amountCents: 3335 }
    ])
  })

  it('participantes duplicados se deduplican', () => {
    const shares = splitExpense(1000, ['a', 'a', 'b'])
    expect(shares).toHaveLength(2)
  })

  it('importe 0 reparte 0 a todos', () => {
    const shares = splitExpense(0, participants(4))
    expect(shares.every(s => s.amountCents === 0)).toBe(true)
  })

  it('el orden de salida es determinista independientemente del orden de entrada', () => {
    const a = splitExpense(9999, ['c', 'a', 'b'])
    const b = splitExpense(9999, ['b', 'c', 'a'])
    expect(a).toEqual(b)
  })

  it('Σ shares === amountCents para un barrido amplio de importes y N (property-based)', () => {
    for (let amountCents = 0; amountCents <= 5000; amountCents += 37) {
      for (let n = 1; n <= 11; n++) {
        const shares = splitExpense(amountCents, participants(n))
        const sum = shares.reduce((acc, s) => acc + s.amountCents, 0)
        expect(sum).toBe(amountCents)
        expect(shares.every(s => s.amountCents >= 0)).toBe(true)
        // El residuo (0..N-1 céntimos) se lo lleva entero el último participante — el resto
        // recibe exactamente floor(amountCents/n), así que solo puede haber un valor "base"
        // más, como mucho, un último elemento distinto.
        const base = Math.floor(amountCents / n)
        expect(shares.slice(0, -1).every(s => s.amountCents === base)).toBe(true)
      }
    }
  })
})
