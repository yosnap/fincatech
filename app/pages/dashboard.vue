<script setup lang="ts">
definePageMeta({ middleware: ['auth'] })

interface DebtSummaryItem {
  id: string
  expenseId: string
  expenseDescription: string
  amountCents: number
  status: string
  counterpartyId: string
  counterpartyName: string
  createdAt: string
}

interface HistoryEntry {
  monthKey: string
  totalCents: number
  count: number
}

interface DashboardSummary {
  pendingAsDebtor: DebtSummaryItem[]
  pendingAsCreditor: DebtSummaryItem[]
  paymentHistory: HistoryEntry[]
  aggregateTotals: { monthCents: number, quarterCents: number, allTimeCents: number }
}

const { data } = await useFetch<DashboardSummary>('/api/dashboard')

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  pending_confirmation: 'Pendiente de confirmación'
}

function formatEuros(cents: number) {
  return (cents / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })
}

function formatMonth(monthKey: string) {
  const [year, month] = monthKey.split('-')
  const date = new Date(Number(year), Number(month) - 1, 1)
  return date.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
}

const totalPendingAsDebtor = computed(() => (data.value?.pendingAsDebtor ?? []).reduce((sum, d) => sum + d.amountCents, 0))
const totalPendingAsCreditor = computed(() => (data.value?.pendingAsCreditor ?? []).reduce((sum, d) => sum + d.amountCents, 0))
</script>

<template>
  <div
    v-if="data"
    class="mx-auto flex max-w-2xl flex-col gap-6 py-10"
  >
    <h1 class="text-xl font-semibold">
      Central de gastos
    </h1>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <UCard>
        <p class="text-sm text-muted">
          Este mes (fondo común)
        </p>
        <p class="text-lg font-semibold">
          {{ formatEuros(data.aggregateTotals.monthCents) }}
        </p>
      </UCard>
      <UCard>
        <p class="text-sm text-muted">
          Este trimestre (fondo común)
        </p>
        <p class="text-lg font-semibold">
          {{ formatEuros(data.aggregateTotals.quarterCents) }}
        </p>
      </UCard>
      <UCard>
        <p class="text-sm text-muted">
          Histórico total (fondo común)
        </p>
        <p class="text-lg font-semibold">
          {{ formatEuros(data.aggregateTotals.allTimeCents) }}
        </p>
      </UCard>
    </div>

    <UCard>
      <template #header>
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">
            Lo que debo
          </h2>
          <UBadge
            v-if="data.pendingAsDebtor.length"
            color="error"
            variant="soft"
          >
            {{ formatEuros(totalPendingAsDebtor) }}
          </UBadge>
        </div>
      </template>
      <div class="flex flex-col divide-y divide-default">
        <div
          v-for="debt in data.pendingAsDebtor"
          :key="debt.id"
          class="flex items-center justify-between py-2 text-sm"
        >
          <div>
            <p class="font-medium">
              {{ debt.expenseDescription }}
            </p>
            <p class="text-muted">
              A {{ debt.counterpartyName }} · {{ STATUS_LABELS[debt.status] ?? debt.status }}
            </p>
          </div>
          <p class="font-medium">
            {{ formatEuros(debt.amountCents) }}
          </p>
        </div>
        <p
          v-if="!data.pendingAsDebtor.length"
          class="py-4 text-center text-muted"
        >
          No debes nada pendiente
        </p>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">
            Lo que me deben
          </h2>
          <UBadge
            v-if="data.pendingAsCreditor.length"
            color="success"
            variant="soft"
          >
            {{ formatEuros(totalPendingAsCreditor) }}
          </UBadge>
        </div>
      </template>
      <div class="flex flex-col divide-y divide-default">
        <div
          v-for="debt in data.pendingAsCreditor"
          :key="debt.id"
          class="flex items-center justify-between py-2 text-sm"
        >
          <div>
            <p class="font-medium">
              {{ debt.expenseDescription }}
            </p>
            <p class="text-muted">
              {{ debt.counterpartyName }} · {{ STATUS_LABELS[debt.status] ?? debt.status }}
            </p>
          </div>
          <p class="font-medium">
            {{ formatEuros(debt.amountCents) }}
          </p>
        </div>
        <p
          v-if="!data.pendingAsCreditor.length"
          class="py-4 text-center text-muted"
        >
          Nadie te debe nada pendiente
        </p>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <h2 class="text-lg font-semibold">
          Historial de pagos confirmados
        </h2>
      </template>
      <div class="flex flex-col divide-y divide-default">
        <div
          v-for="entry in data.paymentHistory"
          :key="entry.monthKey"
          class="flex items-center justify-between py-2 text-sm capitalize"
        >
          <p>{{ formatMonth(entry.monthKey) }}</p>
          <p class="font-medium">
            {{ formatEuros(entry.totalCents) }} ({{ entry.count }} {{ entry.count === 1 ? 'pago' : 'pagos' }})
          </p>
        </div>
        <p
          v-if="!data.paymentHistory.length"
          class="py-4 text-center text-muted"
        >
          Sin pagos confirmados todavía
        </p>
      </div>
    </UCard>
  </div>
</template>
