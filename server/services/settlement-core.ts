// Cálculo puro de la liquidación de cuentas entre el usuario actual y cada contraparte
// (sin acceso a DB — el wrapper con consultas vive en settlement-service.ts). Todo en
// céntimos enteros, mismo criterio que el resto del dominio financiero.

export interface SettlementLine {
  debtId: string
  expenseId: string
  description: string
  amountCents: number
  status: string
  createdAt: Date
}

export interface CounterpartySettlement {
  userId: string
  name: string
  // Total histórico de recibos pagados por esta persona (contexto global de cuánto ha
  // gastado). null cuando el rol no puede ver desglose económico de terceros (Invitado).
  totalSpentCents: number | null
  // Mi parte pendiente de SUS recibos — lo que le debo a esta persona.
  iOweThemCents: number
  iOweThemLines: SettlementLine[]
  // Su parte pendiente de MIS recibos — lo que esta persona me debe a mí.
  theyOweMeCents: number
  theyOweMeLines: SettlementLine[]
  // Diferencia final: > 0 → me debe netCents; < 0 → le debo |netCents|; 0 → compensados.
  netCents: number
}

export interface Settlement {
  totalTheyOweMeCents: number
  totalIOweThemCents: number
  totalNetCents: number
  counterparties: CounterpartySettlement[]
}

export interface SettlementInputDebt {
  id: string
  expenseId: string
  debtorId: string
  creditorId: string
  amountCents: number
  status: string
  createdAt: Date
}

export interface SettlementInputExpense {
  id: string
  description: string
  createdBy: string
  amountCents: number
}

export interface SettlementInputUser {
  id: string
  name: string
}

export function computeSettlement(
  userId: string,
  allDebts: SettlementInputDebt[],
  allExpenses: SettlementInputExpense[],
  allUsers: SettlementInputUser[],
  includeSpentTotals: boolean
): Settlement {
  const expenseMap = new Map(allExpenses.map(e => [e.id, e]))
  const nameMap = new Map(allUsers.map(u => [u.id, u.name]))
  const spentByCreator = new Map<string, number>()
  for (const expense of allExpenses) {
    spentByCreator.set(expense.createdBy, (spentByCreator.get(expense.createdBy) ?? 0) + expense.amountCents)
  }

  // Solo deuda viva (no confirmada) — mismo criterio que el saldo de la Central de gastos:
  // una cuota ya confirmada (pagada) no participa en la liquidación.
  const pendingByCounterparty = new Map<string, { theyOweMe: SettlementLine[], iOweThem: SettlementLine[] }>()
  function bucket(counterpartyId: string) {
    let entry = pendingByCounterparty.get(counterpartyId)
    if (!entry) {
      entry = { theyOweMe: [], iOweThem: [] }
      pendingByCounterparty.set(counterpartyId, entry)
    }
    return entry
  }

  for (const debt of allDebts) {
    if (debt.status === 'confirmed') continue
    // Guarda defensiva: una deuda de alguien consigo mismo no participa en la liquidación.
    if (debt.debtorId === debt.creditorId) continue
    const expense = expenseMap.get(debt.expenseId)
    const line: SettlementLine = {
      debtId: debt.id,
      expenseId: debt.expenseId,
      description: expense?.description ?? '',
      amountCents: debt.amountCents,
      status: debt.status,
      createdAt: debt.createdAt
    }
    if (debt.creditorId === userId) {
      bucket(debt.debtorId).theyOweMe.push(line)
    } else if (debt.debtorId === userId) {
      bucket(debt.creditorId).iOweThem.push(line)
    }
    // Deudas entre terceros no afectan a la liquidación del usuario actual.
  }

  const counterparties: CounterpartySettlement[] = [...pendingByCounterparty.entries()].map(([counterpartyId, entry]) => {
    const theyOweMeCents = entry.theyOweMe.reduce((sum, l) => sum + l.amountCents, 0)
    const iOweThemCents = entry.iOweThem.reduce((sum, l) => sum + l.amountCents, 0)
    return {
      userId: counterpartyId,
      name: nameMap.get(counterpartyId) ?? counterpartyId,
      totalSpentCents: includeSpentTotals ? (spentByCreator.get(counterpartyId) ?? 0) : null,
      theyOweMeCents,
      theyOweMeLines: entry.theyOweMe.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
      iOweThemCents,
      iOweThemLines: entry.iOweThem.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
      netCents: theyOweMeCents - iOweThemCents
    }
  })

  // Lo relevante primero: mayor |diferencia| arriba; desempate por nombre para determinismo.
  counterparties.sort((a, b) => Math.abs(b.netCents) - Math.abs(a.netCents) || a.name.localeCompare(b.name))

  const totalTheyOweMeCents = counterparties.reduce((sum, c) => sum + c.theyOweMeCents, 0)
  const totalIOweThemCents = counterparties.reduce((sum, c) => sum + c.iOweThemCents, 0)

  return {
    totalTheyOweMeCents,
    totalIOweThemCents,
    totalNetCents: totalTheyOweMeCents - totalIOweThemCents,
    counterparties
  }
}
