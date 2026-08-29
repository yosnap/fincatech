<script setup lang="ts">
import { authClient } from '~/utils/auth-client'

definePageMeta({ middleware: ['auth'] })

interface DebtSummary {
  id: string
  debtorId: string
  creditorId: string
  amountCents: number
  status: string
}

interface ExpenseItem {
  id: string
  description: string
  amountCents: number
  type: string
  hasProof: boolean
  status: string
  createdBy?: string
  createdByName: string
  createdAt: string
  participantCount: number
  debts?: DebtSummary[]
}

const session = authClient.useSession()
const { data, refresh } = await useFetch<{ expenses: ExpenseItem[] }>('/api/expenses')

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  partial: 'Pago parcial',
  settled: 'Liquidado'
}

const TYPE_LABELS: Record<string, string> = {
  manual: 'Manual',
  bank_receipt: 'Recibo bancario',
  derrama: 'Derrama'
}

const MONTH_LABELS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

const canCreate = computed(() => {
  const role = (session.value.data?.user as { role?: string } | undefined)?.role
  return role === 'admin' || role === 'owner'
})

// ---- Filtros, orden y paginación (en cliente: el listado completo ya se carga aquí y el
// ---- dashboard ya usa este patrón para su historial; con el volumen de una finca es
// ---- instantáneo y evita re-consultar en cada cambio de filtro).
const monthFilter = ref<number | 'all'>('all')
const yearFilter = ref<number | 'all'>('all')
const userFilter = ref<string | 'all'>('all')
const statusFilter = ref<'all' | 'pending' | 'partial' | 'settled'>('all')
const sortBy = ref<'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc'>('date-desc')
const viewMode = ref<'list' | 'person'>('list')

const MONTH_OPTIONS = [
  { label: 'Todos los meses', value: 'all' },
  ...MONTH_LABELS.map((label, index) => ({ label, value: index }))
]
const YEAR_OPTIONS = computed(() => {
  const years = [...new Set((data.value?.expenses ?? [])
    .map(e => new Date(e.createdAt).getUTCFullYear()))].sort((a, b) => b - a)
  return [{ label: 'Todos los años', value: 'all' }, ...years.map(y => ({ label: String(y), value: y }))]
})
// Clave de persona: id cuando el rol lo ve; para el Invitado (que no recibe createdBy)
// el nombre resuelto — el filtro funciona igual para todos los roles.
function personKey(expense: ExpenseItem): string {
  return expense.createdBy ?? expense.createdByName
}
const USER_OPTIONS = computed(() => {
  const seen = new Map<string, string>()
  for (const e of data.value?.expenses ?? []) {
    if (!seen.has(personKey(e))) seen.set(personKey(e), e.createdByName)
  }
  return [
    { label: 'Todas las personas', value: 'all' },
    ...[...seen.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ label, value }))
  ]
})
const STATUS_OPTIONS = [
  { label: 'Todos los estados', value: 'all' },
  { label: STATUS_LABELS.pending, value: 'pending' },
  { label: STATUS_LABELS.partial, value: 'partial' },
  { label: STATUS_LABELS.settled, value: 'settled' }
]
const SORT_OPTIONS = [
  { label: 'Más recientes primero', value: 'date-desc' },
  { label: 'Más antiguos primero', value: 'date-asc' },
  { label: 'Importe: mayor a menor', value: 'amount-desc' },
  { label: 'Importe: menor a mayor', value: 'amount-asc' }
]

const filtered = computed(() => (data.value?.expenses ?? []).filter((e) => {
  const date = new Date(e.createdAt)
  if (monthFilter.value !== 'all' && date.getUTCMonth() !== monthFilter.value) return false
  if (yearFilter.value !== 'all' && date.getUTCFullYear() !== yearFilter.value) return false
  if (userFilter.value !== 'all' && personKey(e) !== userFilter.value) return false
  if (statusFilter.value !== 'all' && e.status !== statusFilter.value) return false
  return true
}))

const sorted = computed(() => [...filtered.value].sort((a, b) => {
  switch (sortBy.value) {
    case 'amount-desc': return b.amountCents - a.amountCents
    case 'amount-asc': return a.amountCents - b.amountCents
    case 'date-asc': return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    default: return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  }
}))

const filteredTotalCents = computed(() => filtered.value.reduce((sum, e) => sum + e.amountCents, 0))

// Vista por persona: grupos con subtotal propio; la nota de "qué ha gastado cada uno"
// queda visible sin depender de la liquidación de deudas.
interface PersonGroup {
  key: string
  name: string
  expenses: ExpenseItem[]
  totalCents: number
}
const personGroups = computed<PersonGroup[]>(() => {
  const byPerson = new Map<string, PersonGroup>()
  for (const expense of sorted.value) {
    const key = personKey(expense)
    let group = byPerson.get(key)
    if (!group) {
      group = { key, name: expense.createdByName, expenses: [], totalCents: 0 }
      byPerson.set(key, group)
    }
    group.expenses.push(expense)
    group.totalCents += expense.amountCents
  }
  return [...byPerson.values()].sort((a, b) => b.totalCents - a.totalCents)
})

const page = ref(1)
const ITEMS_PER_PAGE = 10
const pagedExpenses = computed(() => sorted.value.slice((page.value - 1) * ITEMS_PER_PAGE, page.value * ITEMS_PER_PAGE))
watch([monthFilter, yearFilter, userFilter, statusFilter, sortBy, viewMode, () => data.value?.expenses.length], () => {
  page.value = 1
})
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-6 py-10">
    <h1 class="text-xl font-semibold">
      Libro contable
    </h1>

    <template v-if="canCreate">
      <UButton
        to="/expenses/new-from-ticket"
        variant="soft"
        icon="i-lucide-camera"
      >
        Nuevo gasto desde foto de ticket (OCR)
      </UButton>
      <ExpenseForm @created="refresh" />
    </template>

    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon
            name="i-lucide-filter"
            class="size-4 text-muted"
          />
          <h2 class="text-sm font-semibold">
            Filtros
          </h2>
        </div>
      </template>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <USelect
          v-model="monthFilter"
          :items="MONTH_OPTIONS"
          icon="i-lucide-calendar"
        />
        <USelect
          v-model="yearFilter"
          :items="YEAR_OPTIONS"
          icon="i-lucide-calendar-range"
        />
        <USelect
          v-model="userFilter"
          :items="USER_OPTIONS"
          icon="i-lucide-user"
        />
        <USelect
          v-model="statusFilter"
          :items="STATUS_OPTIONS"
          icon="i-lucide-check-circle"
        />
        <USelect
          v-model="sortBy"
          :items="SORT_OPTIONS"
          icon="i-lucide-arrow-down-up"
        />
        <UButtonGroup
          variant="soft"
          class="w-full sm:w-auto"
        >
          <UButton
            :variant="viewMode === 'list' ? 'solid' : 'soft'"
            icon="i-lucide-list"
            aria-label="Vista lista"
            title="Vista lista"
            @click="viewMode = 'list'"
          />
          <UButton
            :variant="viewMode === 'person' ? 'solid' : 'soft'"
            icon="i-lucide-users"
            aria-label="Vista por persona"
            title="Vista por persona"
            @click="viewMode = 'person'"
          />
        </UButtonGroup>
      </div>
    </UCard>

    <p class="text-sm text-muted">
      {{ filtered.length }} {{ filtered.length === 1 ? 'gasto' : 'gastos' }} · Total: <span class="font-semibold text-highlighted">{{ formatEuros(filteredTotalCents) }}</span>
    </p>

    <UCard v-if="viewMode === 'list'">
      <div class="flex flex-col divide-y divide-default">
        <NuxtLink
          v-for="expense in pagedExpenses"
          :key="expense.id"
          :to="`/ledger/${expense.id}`"
          class="flex items-center justify-between py-3"
        >
          <div>
            <p class="font-medium">
              {{ expense.description }}
            </p>
            <p class="flex flex-wrap items-center gap-1 text-sm text-muted">
              {{ new Date(expense.createdAt).toLocaleDateString('es-ES') }} · {{ expense.createdByName }}
              <span class="ml-1 inline-flex items-center gap-0.5">
                <UIcon
                  name="i-lucide-users"
                  class="size-3.5"
                />
                {{ expense.participantCount }}
              </span>
              <UBadge
                v-if="TYPE_LABELS[expense.type]"
                variant="subtle"
                size="sm"
              >
                {{ TYPE_LABELS[expense.type] }}
              </UBadge>
            </p>
          </div>
          <div class="text-right">
            <p class="font-medium">
              {{ formatEuros(expense.amountCents) }}
            </p>
            <UBadge
              :color="expense.status === 'settled' ? 'success' : expense.status === 'partial' ? 'warning' : 'error'"
              variant="soft"
            >
              {{ STATUS_LABELS[expense.status] ?? expense.status }}
            </UBadge>
          </div>
        </NuxtLink>
        <p
          v-if="!filtered.length"
          class="py-6 text-center text-muted"
        >
          Sin gastos con estos filtros
        </p>
      </div>
      <div
        v-if="sorted.length > ITEMS_PER_PAGE"
        class="mt-4 flex justify-center"
      >
        <UPagination
          v-model:page="page"
          :total="sorted.length"
          :items-per-page="ITEMS_PER_PAGE"
        />
      </div>
    </UCard>

    <UCard v-else>
      <div class="flex flex-col divide-y divide-default">
        <div
          v-for="group in personGroups"
          :key="group.key"
          class="flex flex-col gap-1 py-3"
        >
          <div class="flex items-center justify-between">
            <p class="font-semibold">
              {{ group.name }}
              <span class="text-sm font-normal text-muted">· {{ group.expenses.length }} {{ group.expenses.length === 1 ? 'gasto' : 'gastos' }}</span>
            </p>
            <UBadge
              color="primary"
              variant="soft"
            >
              {{ formatEuros(group.totalCents) }}
            </UBadge>
          </div>
          <NuxtLink
            v-for="expense in group.expenses"
            :key="expense.id"
            :to="`/ledger/${expense.id}`"
            class="flex items-center justify-between py-1 text-sm"
          >
            <p class="min-w-0 truncate">
              {{ expense.description }}
              <span class="text-muted">· {{ new Date(expense.createdAt).toLocaleDateString('es-ES') }}</span>
            </p>
            <span class="shrink-0 font-medium">{{ formatEuros(expense.amountCents) }}</span>
          </NuxtLink>
        </div>
        <p
          v-if="!personGroups.length"
          class="py-6 text-center text-muted"
        >
          Sin gastos con estos filtros
        </p>
      </div>
    </UCard>
  </div>
</template>
