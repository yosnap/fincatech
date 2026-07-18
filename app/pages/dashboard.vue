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
    </UCard>

    <UCard>
      <template #header>
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <UIcon
              name="i-lucide-arrow-up-circle"
              class="size-5 text-error"
            />
            <h2 class="text-lg font-semibold">
              Lo que debo (pendiente)
            </h2>
          </div>
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
          <template v-if="debt.status === 'pending'">
            <MediaPhotoUpload
              :upload-url="`/api/debts/${debt.id}/mark-paid`"
              field-name="proof"
              accept="image/jpeg,image/png,application/pdf"
              label="Adjunta el comprobante"
              description="JPEG, PNG o PDF, máx. 10MB — al subirlo se marca como pagada"
              :compress="false"
              @uploaded="refresh"
            />
            <UButton
              size="xs"
              variant="link"
              class="self-start px-0"
              :loading="busyId === debt.id"
              @click="markPaidWithoutProof(debt.id)"
            >
              O marca como pagado sin comprobante
            </UButton>
          </template>
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
          <div class="flex items-center gap-2">
            <UIcon
              name="i-lucide-arrow-down-circle"
              class="size-5 text-success"
            />
            <h2 class="text-lg font-semibold">
              Lo que me deben
            </h2>
          </div>
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
  </div>
</template>
