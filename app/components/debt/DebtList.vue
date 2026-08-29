<script lang="ts">
export interface DebtSummaryItem {
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
</script>

<script setup lang="ts">
const props = defineProps<{
  items: DebtSummaryItem[]
  // 'debtor' → líneas con acción "marcar pagado"; 'creditor' → acción "confirmar recepción".
  side: 'debtor' | 'creditor'
  title: string
  icon: string
  totalCents: number
  badgeColor: 'error' | 'success'
  emptyText: string
  busyId: string | null
  // Origen de navegación, se propaga a cada línea para el "Volver" contextual del detalle.
  origin?: 'dashboard' | 'ledger' | 'liquidacion'
}>()

const emit = defineEmits<{
  'confirm': [debtId: string]
  'mark-paid': [debtId: string]
  'refresh': []
}>()

// Clases literales a propósito (Tailwind las detecta escaneando el fuente, no en runtime).
type SortValue = 'amount-desc' | 'amount-asc' | 'date-desc' | 'date-asc'
const SORT_OPTIONS: { label: string, value: SortValue }[] = [
  { label: 'Importe: mayor a menor', value: 'amount-desc' },
  { label: 'Importe: menor a mayor', value: 'amount-asc' },
  { label: 'Más recientes primero', value: 'date-desc' },
  { label: 'Más antiguas primero', value: 'date-asc' }
]

const grouped = ref(true)
const sortBy = ref<SortValue>('amount-desc')
const page = ref(1)
const ITEMS_PER_PAGE = 8

function compareLines(a: DebtSummaryItem, b: DebtSummaryItem): number {
  switch (sortBy.value) {
    case 'amount-desc':
      return b.amountCents - a.amountCents
    case 'amount-asc':
      return a.amountCents - b.amountCents
    case 'date-desc':
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    case 'date-asc':
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  }
}

const sortedItems = computed(() => [...props.items].sort(compareLines))

const pagedItems = computed(() => sortedItems.value.slice((page.value - 1) * ITEMS_PER_PAGE, page.value * ITEMS_PER_PAGE))

interface DebtGroup {
  key: string
  name: string
  lines: DebtSummaryItem[]
  totalCents: number
}

const groups = computed<DebtGroup[]>(() => {
  const byPerson = new Map<string, DebtSummaryItem[]>()
  for (const item of props.items) {
    const lines = byPerson.get(item.counterpartyId) ?? []
    lines.push(item)
    byPerson.set(item.counterpartyId, lines)
  }
  const list: DebtGroup[] = [...byPerson.entries()].map(([key, lines]) => ({
    key,
    name: lines[0]?.counterpartyName ?? key,
    lines: [...lines].sort(compareLines),
    totalCents: lines.reduce((sum, l) => sum + l.amountCents, 0)
  }))
  // Mismo criterio de orden que las líneas planas, aplicado al subtotal del grupo
  // (para fechas, la línea más reciente/antigua de cada persona).
  return list.sort((a, b) => {
    if (sortBy.value === 'amount-asc') return a.totalCents - b.totalCents
    if (sortBy.value === 'amount-desc') return b.totalCents - a.totalCents
    const timeOf = (g: DebtGroup) => g.lines.map(l => new Date(l.createdAt).getTime())
    if (sortBy.value === 'date-asc') return Math.min(...timeOf(a)) - Math.min(...timeOf(b))
    return Math.max(...timeOf(b)) - Math.max(...timeOf(a))
  })
})

// Cambiar filtro u orden puede dejar la página actual fuera de rango → volver a la 1ª.
watch([sortBy, grouped, () => props.items.length], () => {
  page.value = 1
})
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <UIcon
            :name="icon"
            class="size-5"
            :class="badgeColor === 'error' ? 'text-error' : 'text-success'"
          />
          <h2 class="text-lg font-semibold">
            {{ title }}
          </h2>
        </div>
        <UBadge
          v-if="items.length"
          :color="badgeColor"
          variant="soft"
        >
          {{ formatEuros(totalCents) }}
        </UBadge>
      </div>
    </template>

    <div
      v-if="items.length"
      class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <USwitch
        v-model="grouped"
        label="Agrupar por persona"
        size="sm"
      />
      <USelect
        v-model="sortBy"
        :items="SORT_OPTIONS"
        class="w-full sm:w-56"
        size="sm"
      />
    </div>

    <div
      v-if="!items.length"
      class="py-4 text-center text-muted"
    >
      {{ emptyText }}
    </div>

    <template v-else-if="grouped">
      <div class="flex flex-col divide-y divide-default">
        <div
          v-for="group in groups"
          :key="group.key"
          class="flex flex-col gap-1 py-3"
        >
          <div class="flex items-center justify-between">
            <p class="font-semibold">
              {{ group.name }}
              <span class="text-sm font-normal text-muted">· {{ group.lines.length }} {{ group.lines.length === 1 ? 'cuota' : 'cuotas' }}</span>
            </p>
            <UBadge
              :color="badgeColor"
              variant="soft"
            >
              {{ formatEuros(group.totalCents) }}
            </UBadge>
          </div>
          <DebtLine
            v-for="line in group.lines"
            :key="line.id"
            :line="line"
            :side="side"
            :show-counterparty="false"
            :busy-id="busyId"
            :origin="origin"
            @confirm="emit('confirm', $event)"
            @mark-paid="emit('mark-paid', $event)"
            @refresh="emit('refresh')"
          />
        </div>
      </div>
    </template>

    <template v-else>
      <div class="flex flex-col divide-y divide-default">
        <DebtLine
          v-for="line in pagedItems"
          :key="line.id"
          :line="line"
          :side="side"
          :show-counterparty="true"
          :busy-id="busyId"
          :origin="origin"
          @confirm="emit('confirm', $event)"
          @mark-paid="emit('mark-paid', $event)"
          @refresh="emit('refresh')"
        />
      </div>
      <div
        v-if="sortedItems.length > ITEMS_PER_PAGE"
        class="mt-4 flex justify-center"
      >
        <UPagination
          v-model:page="page"
          :total="sortedItems.length"
          :items-per-page="ITEMS_PER_PAGE"
        />
      </div>
    </template>
  </UCard>
</template>
