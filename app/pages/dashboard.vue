<script setup lang="ts">
import type { DebtSummaryItem } from '~/components/debt/DebtList.vue'

definePageMeta({ middleware: ['auth'] })

interface DashboardSummary {
  pendingAsDebtor: DebtSummaryItem[]
  pendingAsCreditor: DebtSummaryItem[]
  paidAsDebtor: DebtSummaryItem[]
  paidAsCreditor: DebtSummaryItem[]
  aggregateTotals: { monthCents: number, quarterCents: number, allTimeCents: number }
}

const { data, refresh } = await useFetch<DashboardSummary>('/api/dashboard')

const PERIODS = [
  { label: 'Esta semana', value: 'week' },
  { label: 'Este mes', value: 'month' },
  { label: 'Histórico', value: 'all' }
]
const period = ref<'week' | 'month' | 'all'>('month')

// Clases completas y literales a propósito (no interpolación con `${}`): Tailwind detecta
// utilidades escaneando el texto fuente tal cual, una clase construida dinámicamente en
// runtime no aparece en el CSS generado.
const PERIOD_CARDS = [
  { key: 'monthCents', label: 'Este mes', icon: 'i-lucide-calendar', textClass: 'text-primary', ringClass: 'ring-primary/25' },
  { key: 'quarterCents', label: 'Este trimestre', icon: 'i-lucide-calendar-range', textClass: 'text-info', ringClass: 'ring-info/25' },
  { key: 'allTimeCents', label: 'Histórico total', icon: 'i-lucide-history', textClass: 'text-warning', ringClass: 'ring-warning/25' }
] as const

function periodStart(): Date {
  const now = new Date()
  if (period.value === 'week') {
    const day = now.getDay() === 0 ? 7 : now.getDay() // lunes = inicio de semana
    const start = new Date(now)
    start.setDate(now.getDate() - (day - 1))
    start.setHours(0, 0, 0, 0)
    return start
  }
  if (period.value === 'month') {
    return new Date(now.getFullYear(), now.getMonth(), 1)
  }
  return new Date(0)
}

function inPeriod(item: DebtSummaryItem): boolean {
  if (!item.confirmedAt) return false
  return new Date(item.confirmedAt) >= periodStart()
}

const totalPendingAsDebtor = computed(() => (data.value?.pendingAsDebtor ?? []).reduce((sum, d) => sum + d.amountCents, 0))
const totalPendingAsCreditor = computed(() => (data.value?.pendingAsCreditor ?? []).reduce((sum, d) => sum + d.amountCents, 0))
const netBalanceCents = computed(() => totalPendingAsCreditor.value - totalPendingAsDebtor.value)

const paidByMeInPeriod = computed(() => (data.value?.paidAsDebtor ?? []).filter(inPeriod))
const paidToMeInPeriod = computed(() => (data.value?.paidAsCreditor ?? []).filter(inPeriod))
const totalPaidByMeInPeriod = computed(() => paidByMeInPeriod.value.reduce((sum, d) => sum + d.amountCents, 0))
const totalPaidToMeInPeriod = computed(() => paidToMeInPeriod.value.reduce((sum, d) => sum + d.amountCents, 0))

// Historial: mismas utilidades de orden y paginación que las listas de deudas, para que
// las cuatro secciones de la página se comporten igual.
const historySortBy = ref<'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc'>('date-desc')
const HISTORY_SORT_OPTIONS: { label: string, value: 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc' }[] = [
  { label: 'Más recientes primero', value: 'date-desc' },
  { label: 'Más antiguas primero', value: 'date-asc' },
  { label: 'Importe: mayor a menor', value: 'amount-desc' },
  { label: 'Importe: menor a mayor', value: 'amount-asc' }
]
const historyPage = ref(1)
const HISTORY_PER_PAGE = 8

const historySorted = computed(() => [...paidByMeInPeriod.value].sort((a, b) => {
  switch (historySortBy.value) {
    case 'amount-desc': return b.amountCents - a.amountCents
    case 'amount-asc': return a.amountCents - b.amountCents
    case 'date-asc': return new Date(a.confirmedAt ?? 0).getTime() - new Date(b.confirmedAt ?? 0).getTime()
    default: return new Date(b.confirmedAt ?? 0).getTime() - new Date(a.confirmedAt ?? 0).getTime()
  }
}))
const historyPaged = computed(() => historySorted.value.slice((historyPage.value - 1) * HISTORY_PER_PAGE, historyPage.value * HISTORY_PER_PAGE))

watch([historySortBy, () => paidByMeInPeriod.value.length], () => {
  historyPage.value = 1
})

const toast = useToast()
const busyId = ref<string | null>(null)

async function confirmDebt(debtId: string) {
  busyId.value = debtId
  try {
    await $fetch(`/api/debts/${debtId}/confirm`, { method: 'POST' })
    await refresh()
    toast.add({ title: 'Cuota confirmada', color: 'success' })
  } catch {
    toast.add({ title: 'No se pudo confirmar la cuota', color: 'error' })
  } finally {
    busyId.value = null
  }
}

async function markPaidWithoutProof(debtId: string) {
  const confirmed = await useConfirmDialog()({
    title: 'Marcar como pagado sin comprobante',
    description: 'Quedará pendiente de que la otra persona (o un Admin) confirme que lo recibió.',
    confirmLabel: 'Marcar como pagado',
    color: 'primary'
  })
  if (!confirmed) return

  busyId.value = debtId
  try {
    await $fetch(`/api/debts/${debtId}/mark-paid`, { method: 'POST' })
    await refresh()
    toast.add({ title: 'Marcado como pagado, pendiente de confirmación', color: 'success' })
  } catch {
    toast.add({ title: 'No se pudo marcar como pagado', color: 'error' })
  } finally {
    busyId.value = null
  }
}
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
      <UCard
        v-for="card in PERIOD_CARDS"
        :key="card.key"
        :class="card.ringClass"
      >
        <div class="flex items-center gap-2">
          <UIcon
            :name="card.icon"
            class="size-4"
            :class="card.textClass"
          />
          <p class="text-sm font-semibold text-highlighted">
            {{ card.label }}
          </p>
        </div>
        <p
          class="mt-1 text-2xl font-bold"
          :class="card.textClass"
        >
          {{ formatEuros(data.aggregateTotals[card.key]) }}
        </p>
        <p class="text-xs text-muted">
          gasto total comunidad
        </p>
      </UCard>
    </div>

    <UCard>
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-scale"
          class="size-4 text-muted"
        />
        <p class="text-sm text-muted">
          Tu saldo (lo que te deben menos lo que debes)
        </p>
      </div>
      <p
        class="text-3xl font-bold"
        :class="netBalanceCents > 0 ? 'text-success' : netBalanceCents < 0 ? 'text-error' : ''"
      >
        {{ netBalanceCents >= 0 ? '+' : '' }}{{ formatEuros(netBalanceCents) }}
      </p>
      <p class="text-xs text-muted">
        {{ netBalanceCents > 0 ? 'Te deben más de lo que debes' : netBalanceCents < 0 ? 'Debes más de lo que te deben' : 'Estás al día' }}
      </p>
      <NuxtLink
        to="/liquidacion"
        class="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline"
      >
        Ver la liquidación por persona
        <UIcon
          name="i-lucide-arrow-right"
          class="size-3.5"
        />
      </NuxtLink>
    </UCard>

    <DebtList
      :busy-id="busyId"
      :items="data.pendingAsDebtor"
      side="debtor"
      origin="dashboard"
      title="Lo que debo"
      icon="i-lucide-arrow-up-circle"
      :total-cents="totalPendingAsDebtor"
      badge-color="error"
      empty-text="No debes nada pendiente"
      @confirm="confirmDebt"
      @mark-paid="markPaidWithoutProof"
      @refresh="refresh"
    />

    <DebtList
      :busy-id="busyId"
      :items="data.pendingAsCreditor"
      side="creditor"
      origin="dashboard"
      title="Lo que me deben"
      icon="i-lucide-arrow-down-circle"
      :total-cents="totalPendingAsCreditor"
      badge-color="success"
      empty-text="Nadie te debe nada pendiente"
      @confirm="confirmDebt"
      @refresh="refresh"
    />

    <UCard>
      <template #header>
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <UIcon
              name="i-lucide-receipt"
              class="size-5 text-primary"
            />
            <h2 class="text-lg font-semibold">
              Historial de pagos
            </h2>
          </div>
          <USelect
            v-model="period"
            :items="PERIODS"
            class="w-40"
            size="sm"
          />
        </div>
      </template>

      <div class="grid grid-cols-2 gap-4">
        <div>
          <p class="text-sm text-muted">
            Pagado por mí
          </p>
          <p class="text-lg font-semibold">
            {{ formatEuros(totalPaidByMeInPeriod) }}
          </p>
        </div>
        <div>
          <p class="text-sm text-muted">
            Me han pagado
          </p>
          <p class="text-lg font-semibold">
            {{ formatEuros(totalPaidToMeInPeriod) }}
          </p>
        </div>
      </div>

      <div
        v-if="historySorted.length"
        class="mt-3"
      >
        <USelect
          v-model="historySortBy"
          :items="HISTORY_SORT_OPTIONS"
          class="w-full sm:w-56"
          size="sm"
        />
      </div>

      <div class="mt-2 flex flex-col divide-y divide-default">
        <div
          v-for="debt in historyPaged"
          :key="debt.id"
          class="flex items-center justify-between py-2 text-sm"
        >
          <NuxtLink
            :to="`/ledger/${debt.expenseId}?from=dashboard`"
            class="hover:underline"
          >
            {{ debt.expenseDescription }}
            <span class="text-muted">· {{ debt.counterpartyName }}</span>
          </NuxtLink>
          <p>{{ formatEuros(debt.amountCents) }} · {{ new Date(debt.confirmedAt!).toLocaleDateString('es-ES') }}</p>
        </div>
        <p
          v-if="!paidByMeInPeriod.length && !paidToMeInPeriod.length"
          class="py-4 text-center text-muted"
        >
          Sin pagos confirmados en este periodo
        </p>
      </div>

      <div
        v-if="historySorted.length > HISTORY_PER_PAGE"
        class="mt-4 flex justify-center"
      >
        <UPagination
          v-model:page="historyPage"
          :total="historySorted.length"
          :items-per-page="HISTORY_PER_PAGE"
        />
      </div>
    </UCard>
  </div>
</template>
