import { describe, expect, it } from 'vitest'
import { rowsToCsv, type ExportRow } from './export-formatters'

function row(overrides: Partial<ExportRow> = {}): ExportRow {
  return {
    id: 'expense-1',
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    description: 'Recibo de luz',
    type: 'manual',
    amountCents: 12345,
    status: 'confirmed',
    ...overrides
  }
}

describe('rowsToCsv', () => {
  it('neutraliza descripciones que empiezan por caracteres de fórmula (CSV injection)', () => {
    const csv = rowsToCsv([row({ description: '=cmd|/c calc' })])
    const line = csv.split('\n')[1]!
    expect(line).toContain('\'=cmd|/c calc')
  })

  it('neutraliza +, -, @ y tabulador como primer carácter', () => {
    for (const trigger of ['+1', '-1', '@SUM(A1)', '\tmalicious']) {
      const csv = rowsToCsv([row({ description: trigger })])
      const line = csv.split('\n')[1]!
      expect(line.includes(`'${trigger}`) || line.includes(`"'${trigger}`)).toBe(true)
    }
  })

  it('no altera descripciones normales', () => {
    const csv = rowsToCsv([row({ description: 'Recibo de agua' })])
    expect(csv.split('\n')[1]).toContain('Recibo de agua')
  })

  it('sin debts (Invitado): columnas de deudor quedan vacías, una sola línea por gasto', () => {
    const csv = rowsToCsv([row()])
    const lines = csv.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[1]!.endsWith(',,,')).toBe(true)
  })

  it('con debts (admin/owner): una línea adicional por cada deudor', () => {
    const csv = rowsToCsv([row({
      debts: [
        { debtorId: 'user-a', amountCents: 6000, status: 'pending' },
        { debtorId: 'user-b', amountCents: 6345, status: 'confirmed' }
      ]
    })])
    const lines = csv.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain('user-a')
    expect(lines[2]).toContain('user-b')
  })

  it('escapa comas, comillas y saltos de línea en la descripción', () => {
    const csv = rowsToCsv([row({ description: 'Ticket, con "comillas"' })])
    const line = csv.split('\n')[1]!
    expect(line).toContain('"Ticket, con ""comillas"""')
  })
})
