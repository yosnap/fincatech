<script setup lang="ts">
definePageMeta({ middleware: ['auth'] })

interface MonthlyTotal { monthKey: string, label: string, totalCents: number }
interface ExpenseTypeBreakdown { type: string, label: string, totalCents: number, count: number }
interface OwnerBalance { userId: string, name: string, netCents: number }
interface CreatorTotal { userId: string, name: string, totalCents: number, count: number }

interface ExpenseStatistics {
  monthly: MonthlyTotal[]
  byType: ExpenseTypeBreakdown[]
  byOwner: OwnerBalance[] | null
  byCreator: CreatorTotal[] | null
}

const { data } = await useFetch<ExpenseStatistics>('/api/dashboard/stats')

// Orden fijo de colores por categoría (nunca se reasignan según el ranking de importes).
const TYPE_COLORS: Record<string, string> = {
  manual: 'bg-primary',
  bank_receipt: 'bg-info',
  derrama: 'bg-warning'
}

const monthlyItems = computed(() => (data.value?.monthly ?? []).map(m => ({ label: m.label, valueCents: m.totalCents })))

// Tope para las barras de "recibos subidos por persona" (evita divisiones por cero).
const maxCreatorCents = computed(() => Math.max(1, ...(data.value?.byCreator ?? []).map(c => c.totalCents)))

const typeTotalCents = computed(() => (data.value?.byType ?? []).reduce((sum, t) => sum + t.totalCents, 0))
const expenseCount = computed(() => (data.value?.byType ?? []).reduce((sum, t) => sum + t.count, 0))

// Clases literales a propósito: Tailwind detecta utilidades escaneando el fuente.
const SUMMARY_CARDS = [
  { key: 'total', label: 'Gasto total histórico', icon: 'i-lucide-history', textClass: 'text-warning', ringClass: 'ring-warning/25' },
  { key: 'month', label: 'Este mes', icon: 'i-lucide-calendar', textClass: 'text-primary', ringClass: 'ring-primary/25' },
  { key: 'count', label: 'Gastos registrados', icon: 'i-lucide-receipt', textClass: 'text-info', ringClass: 'ring-info/25' }
] as const

const summary = computed(() => {
  const monthKey = data.value?.monthly.at(-1)
  return {
    total: typeTotalCents.value,
    month: monthKey?.totalCents ?? 0,
    count: expenseCount.value
  }
})

function summaryValue(key: (typeof SUMMARY_CARDS)[number]['key']): string {
  if (key === 'count') return String(summary.value.count)
  return formatEuros(summary.value[key])
}

function sharePercent(totalCents: number): number {
  return typeTotalCents.value > 0 ? Math.round((totalCents / typeTotalCents.value) * 100) : 0
}
</script>

<template>
  <div
    v-if="data"
    class="mx-auto flex max-w-2xl flex-col gap-6 py-10"
  >
    <h1 class="text-xl font-semibold">
      Estadísticas
    </h1>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <UCard
        v-for="card in SUMMARY_CARDS"
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
          {{ summaryValue(card.key) }}
        </p>
      </UCard>
    </div>

    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon
            name="i-lucide-trending-up"
            class="size-5 text-primary"
          />
          <h2 class="text-lg font-semibold">
            Gasto mensual de la comunidad
          </h2>
        </div>
      </template>
      <ChartsSimpleBarChart
        :items="monthlyItems"
        color="bg-primary"
      />
      <p class="mt-2 text-xs text-muted">
        Últimos 12 meses
      </p>
    </UCard>

    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon
            name="i-lucide-pie-chart"
            class="size-5 text-primary"
          />
          <h2 class="text-lg font-semibold">
            Gasto por tipo
          </h2>
        </div>
      </template>
      <div class="flex flex-col gap-4">
        <div
          v-for="type in data.byType"
          :key="type.type"
          class="flex flex-col gap-1"
        >
          <div class="flex items-center justify-between text-sm">
            <p class="font-medium">
              {{ type.label }}
              <span class="text-muted">· {{ type.count }} {{ type.count === 1 ? 'gasto' : 'gastos' }} · {{ sharePercent(type.totalCents) }}%</span>
            </p>
            <p class="font-medium">
              {{ formatEuros(type.totalCents) }}
            </p>
          </div>
          <div class="h-2 w-full overflow-hidden rounded-full bg-elevated">
            <div
              class="h-full rounded-full"
              :class="TYPE_COLORS[type.type] ?? 'bg-neutral'"
              :style="{ width: `${sharePercent(type.totalCents)}%` }"
            />
          </div>
        </div>
        <p
          v-if="!data.byType.length"
          class="py-4 text-center text-sm text-muted"
        >
          Sin gastos todavía
        </p>
      </div>
    </UCard>

    <UCard v-if="data.byCreator">
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon
            name="i-lucide-upload"
            class="size-5 text-primary"
          />
          <h2 class="text-lg font-semibold">
            Recibos subidos por persona
          </h2>
        </div>
      </template>
      <div class="flex flex-col gap-4">
        <div
          v-for="creator in data.byCreator"
          :key="creator.userId"
          class="flex flex-col gap-1"
        >
          <div class="flex items-center justify-between text-sm">
            <p class="font-medium">
              {{ creator.name }}
              <span class="text-muted">· {{ creator.count }} {{ creator.count === 1 ? 'recibo' : 'recibos' }}</span>
            </p>
            <p class="font-medium">
              {{ formatEuros(creator.totalCents) }}
            </p>
          </div>
          <div class="h-2 w-full overflow-hidden rounded-full bg-elevated">
            <div
              class="h-full rounded-full bg-secondary"
              :style="{ width: `${Math.round((creator.totalCents / maxCreatorCents) * 100)}%` }"
            />
          </div>
        </div>
        <p
          v-if="!data.byCreator.length"
          class="py-4 text-center text-sm text-muted"
        >
          Sin recibos todavía
        </p>
      </div>
    </UCard>

    <UCard v-if="data.byOwner">
      <template #header>
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <UIcon
              name="i-lucide-users"
              class="size-5 text-primary"
            />
            <h2 class="text-lg font-semibold">
              Saldo pendiente por propietario
            </h2>
          </div>
          <NuxtLink
            to="/liquidacion"
            class="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            Liquidación
            <UIcon
              name="i-lucide-arrow-right"
              class="size-3.5"
            />
          </NuxtLink>
        </div>
      </template>
      <div class="flex flex-col divide-y divide-default">
        <div
          v-for="owner in data.byOwner"
          :key="owner.userId"
          class="flex items-center justify-between py-2 text-sm"
        >
          <p class="font-medium">
            {{ owner.name }}
          </p>
          <p
            class="font-semibold"
            :class="owner.netCents > 0 ? 'text-success' : 'text-error'"
          >
            {{ owner.netCents >= 0 ? '+' : '' }}{{ formatEuros(owner.netCents) }}
          </p>
        </div>
        <p
          v-if="!data.byOwner.length"
          class="py-4 text-center text-muted"
        >
          Todos los saldos están al día
        </p>
      </div>
    </UCard>
  </div>
</template>
