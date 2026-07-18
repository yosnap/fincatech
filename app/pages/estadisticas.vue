<script setup lang="ts">
definePageMeta({ middleware: ['auth'] })

interface MonthlyTotal { monthKey: string, label: string, totalCents: number }
interface ExpenseTypeBreakdown { type: string, label: string, totalCents: number, count: number }
interface OwnerBalance { userId: string, name: string, netCents: number }

interface ExpenseStatistics {
  monthly: MonthlyTotal[]
  byType: ExpenseTypeBreakdown[]
  byOwner: OwnerBalance[] | null
}

const { data } = await useFetch<ExpenseStatistics>('/api/dashboard/stats')

// Orden fijo de colores por categoría (nunca se reasignan según el ranking de importes).
const TYPE_COLORS: Record<string, string> = {
  manual: 'bg-primary',
  bank_receipt: 'bg-info',
  derrama: 'bg-warning'
}

const monthlyItems = computed(() => (data.value?.monthly ?? []).map(m => ({ label: m.label, valueCents: m.totalCents })))

const typeTotalCents = computed(() => (data.value?.byType ?? []).reduce((sum, t) => sum + t.totalCents, 0))

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
              <span class="text-muted">· {{ type.count }} {{ type.count === 1 ? 'gasto' : 'gastos' }}</span>
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

    <UCard v-if="data.byOwner">
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon
            name="i-lucide-users"
            class="size-5 text-primary"
          />
          <h2 class="text-lg font-semibold">
            Saldo pendiente por propietario
          </h2>
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
