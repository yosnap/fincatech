import PDFDocument from 'pdfkit'

export interface ExportRow {
  id: string
  createdAt: Date
  description: string
  type: string
  amountCents: number
  status: string
  debts?: { debtorId: string, amountCents: number, status: string }[]
}

function formatEuros(cents: number): string {
  return (cents / 100).toFixed(2)
}

// El CSV lo abre habitualmente una gestoría externa en Excel/Sheets: un campo de texto
// libre (description) que empiece por =, +, -, @ se interpreta como fórmula (CSV/Formula
// Injection, CWE-1236) y puede exfiltrar datos o ejecutar código en versiones antiguas con
// DDE. Se neutraliza anteponiendo un apóstrofe, que fuerza texto plano sin alterar el dato.
const FORMULA_TRIGGER_CHARS = new Set(['=', '+', '-', '@', '\t', '\r'])

function neutralizeFormula(value: string): string {
  if (value.length > 0 && FORMULA_TRIGGER_CHARS.has(value[0]!)) {
    return `'${value}`
  }
  return value
}

function csvEscape(value: string): string {
  const neutralized = neutralizeFormula(value)
  if (/[",\n]/.test(neutralized)) return `"${neutralized.replace(/"/g, '""')}"`
  return neutralized
}

// Para admin/owner cada deuda de un gasto se vuelca en una línea adicional bajo el gasto
// (misma fecha/descripción/tipo, columnas de deudor rellenas); para Invitado esas columnas
// quedan vacías porque `row.debts` nunca se calcula (ver export-service.getExportRows).
export function rowsToCsv(rows: ExportRow[]): string {
  const header = ['fecha', 'descripcion', 'tipo', 'importe_eur', 'estado', 'deudor_id', 'importe_deuda_eur', 'estado_deuda']
  const lines = [header.join(',')]
  for (const row of rows) {
    const base = [
      row.createdAt.toISOString().slice(0, 10),
      csvEscape(row.description),
      row.type,
      formatEuros(row.amountCents),
      row.status
    ]
    if (row.debts && row.debts.length > 0) {
      for (const debt of row.debts) {
        lines.push([...base, debt.debtorId, formatEuros(debt.amountCents), debt.status].join(','))
      }
    } else {
      lines.push([...base, '', '', ''].join(','))
    }
  }
  return lines.join('\n')
}

const TYPE_LABELS: Record<string, string> = { manual: 'Gasto manual', bank_receipt: 'Recibo bancario', derrama: 'Derrama' }

export function rowsToPdf(rows: ExportRow[], range: { start: string, end: string }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' })
    const chunks: Buffer[] = []
    doc.on('data', chunk => chunks.push(chunk as Buffer))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    doc.fontSize(16).text('Finca La Unión — Libro de gastos y pagos', { align: 'center' })
    doc.moveDown(0.5)
    doc.fontSize(10).text(`Periodo: ${range.start} a ${range.end}`, { align: 'center' })
    doc.moveDown(0.5)
    doc.fontSize(8).fillColor('gray')
      .text('Documento informativo de uso interno. No constituye un formato fiscal certificado (no Modelo 347 / AEAT).', { align: 'center' })
    doc.fillColor('black')
    doc.moveDown(1)

    doc.fontSize(9)
    for (const row of rows) {
      const line = `${row.createdAt.toISOString().slice(0, 10)}  |  ${TYPE_LABELS[row.type] ?? row.type}  |  ${row.description}  |  ${formatEuros(row.amountCents)} €  |  ${row.status}`
      doc.fillColor('black').fontSize(9).text(line)
      for (const debt of row.debts ?? []) {
        doc.fillColor('gray').fontSize(8).text(`    → deudor ${debt.debtorId}: ${formatEuros(debt.amountCents)} € (${debt.status})`)
      }
    }
    if (rows.length === 0) {
      doc.text('Sin movimientos en el periodo seleccionado.')
    }

    doc.moveDown(1)
    const total = rows.reduce((sum, row) => sum + row.amountCents, 0)
    doc.fontSize(10).text(`Total: ${formatEuros(total)} €`, { align: 'right' })

    doc.end()
  })
}
