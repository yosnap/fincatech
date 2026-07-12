export interface Share {
  userId: string
  amountCents: number
}

// Función pura: dado un importe en céntimos y los participantes (incluye al pagador),
// devuelve la cuota exacta de cada uno. Σ shares === amountCents siempre (invariante
// crítico — ver server/services/debt-splitter.test.ts). Política de redondeo determinista:
// división entera, el residuo (0..N-1 céntimos) se lo lleva el último participante tras
// ordenar por userId — nunca depende del orden de entrada.
export function splitExpense(amountCents: number, participantIds: string[]): Share[] {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new Error('amountCents debe ser un entero >= 0 (céntimos)')
  }
  const uniqueIds = [...new Set(participantIds)]
  if (uniqueIds.length === 0) {
    throw new Error('Se requiere al menos un participante')
  }

  const sorted = uniqueIds.sort()
  const n = sorted.length
  const base = Math.floor(amountCents / n)
  const remainder = amountCents - base * n

  return sorted.map((userId, index) => ({
    userId,
    amountCents: index === n - 1 ? base + remainder : base
  }))
}
