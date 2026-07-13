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
  confirmedAt: string | null
}

interface DashboardSummary {
  pendingAsDebtor: DebtSummaryItem[]
  pendingAsCreditor: DebtSummaryItem[]
  paidAsDebtor: DebtSummaryItem[]
  paidAsCreditor: DebtSummaryItem[]
  aggregateTotals: { monthCents: number, quarterCents: number, allTimeCents: number }
}

const { data, refresh } = await useFetch<DashboardSummary>('/api/dashboard')

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  pending_confirmation: 'Pendiente de confirmación'
}

const PERIODS = [
  { label: 'Esta semana', value: 'week' },
  { label: 'Este mes', value: 'month' },
  { label: 'Histórico', value: 'all' }
]
const period = ref<'week' | 'month' | 'all'>('month')

function formatEuros(cents: number) {
  return (cents / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })
}

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

const busyId = ref<string | null>(null)
const errorMessage = ref('')

async function confirmDebt(debtId: string) {
  errorMessage.value = ''
  busyId.value = debtId
  try {
    await $fetch(`/api/debts/${debtId}/confirm`, { method: 'POST' })
    await refresh()
  } catch {
    errorMessage.value = 'No se pudo confirmar la cuota'
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

    <UCard>
      <p class="text-sm text-muted">
        Tu saldo (lo que te deben menos lo que debes)
      </p>
      <p
        class="text-3xl font-bold"
        :class="netBalanceCents > 0 ? 'text-success' : netBalanceCents < 0 ? 'text-error' : ''"
      >
        {{ netBalanceCents >= 0 ? '+' : '' }}{{ formatEuros(netBalanceCents) }}
      </p>
      <p class="text-xs text-muted">
        {{ netBalanceCents > 0 ? 'Te deben más de lo que debes' : netBalanceCents < 0 ? 'Debes más de lo que te deben' : 'Estás al día' }}
      </p>
    </UCard>

    <UAlert
      v-if="errorMessage"
      color="error"
      variant="soft"
      :title="errorMessage"
    />

    <UCard>
      <template #header>
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">
            Lo que debo (pendiente)
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
          class="flex flex-col gap-2 py-3 text-sm"
        >
          <div class="flex items-center justify-between">
            <NuxtLink
              :to="`/ledger/${debt.expenseId}`"
              class="font-medium hover:underline"
            >
              {{ debt.expenseDescription }}
            </NuxtLink>
            <p class="font-medium">
              {{ formatEuros(debt.amountCents) }}
            </p>
          </div>
          <p class="text-muted">
            A {{ debt.counterpartyName }} · {{ STATUS_LABELS[debt.status] ?? debt.status }}
          </p>
          <MediaPhotoUpload
            v-if="debt.status === 'pending'"
            :upload-url="`/api/debts/${debt.id}/mark-paid`"
            field-name="proof"
            accept="image/jpeg,image/png,application/pdf"
            label="Adjunta el comprobante"
            description="JPEG, PNG o PDF, máx. 10MB — al subirlo se marca como pagada"
            @uploaded="refresh"
          />
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
          class="flex flex-col gap-2 py-3 text-sm"
        >
          <div class="flex items-center justify-between">
            <NuxtLink
              :to="`/ledger/${debt.expenseId}`"
              class="font-medium hover:underline"
            >
              {{ debt.expenseDescription }}
            </NuxtLink>
            <p class="font-medium">
              {{ formatEuros(debt.amountCents) }}
            </p>
          </div>
          <div class="flex items-center justify-between">
            <p class="text-muted">
              {{ debt.counterpartyName }} · {{ STATUS_LABELS[debt.status] ?? debt.status }}
            </p>
            <UButton
              v-if="debt.status === 'pending_confirmation'"
              size="xs"
              color="success"
              :loading="busyId === debt.id"
              @click="confirmDebt(debt.id)"
            >
              Confirmar recepción
            </UButton>
          </div>
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
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">
            Historial de pagos
          </h2>
          <USelect
            v-model="period"
            :items="PERIODS"
            class="w-40"
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

      <div class="mt-4 flex flex-col divide-y divide-default">
        <div
          v-for="debt in paidByMeInPeriod"
          :key="debt.id"
          class="flex items-center justify-between py-2 text-sm"
        >
          <NuxtLink
            :to="`/ledger/${debt.expenseId}`"
            class="hover:underline"
          >
            {{ debt.expenseDescription }}
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
    </UCard>

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
  </div>
</template>
