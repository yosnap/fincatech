<script setup lang="ts">
import { authClient } from '~/utils/auth-client'

definePageMeta({ middleware: ['auth'] })

interface TransactionItem {
  id: string
  date: string
  direction: 'deposit' | 'withdrawal'
  amountCents: number
  description: string
  category: string | null
  hasProof: boolean
  balanceCentsAfter: number
}

interface CashPendingItem {
  id: string
  memberId: string
  memberName: string
  amountCents: number
  date: string
}

interface UnmatchedDeposit {
  id: string
  date: string
  amountCents: number
  description: string
}

interface BankSummary {
  currentCents: number
  prePurchaseCents: number
  cashPendingCents: number
  cashPending: CashPendingItem[]
  unmatchedDeposits: UnmatchedDeposit[]
  fondoComun: unknown
}

interface Settings {
  purchaseDate: string | null
  quotaAmountCents: number | null
  quotaStartMonth: string | null
}

const session = authClient.useSession()
const role = computed(() => (session.value.data?.user as { role?: string } | undefined)?.role)
const isAdmin = computed(() => role.value === 'admin')

const { data: txData, refresh: refreshTransactions } = await useFetch<{ transactions: TransactionItem[] }>('/api/bank/transactions')
const { data: summary, refresh: refreshSummary } = await useFetch<BankSummary>('/api/bank/summary')
const { data: settings, refresh: refreshSettings } = await useFetch<Settings>('/api/bank/settings')

async function refreshAll() {
  await Promise.all([refreshTransactions(), refreshSummary(), refreshSettings()])
}

// ---- Modales y acciones ----
const formOpen = ref(false)
// Movimiento en edición (null = alta nueva). Se limpia al cerrar el formulario.
const editTarget = ref<TransactionItem | null>(null)
const proofTarget = ref<TransactionItem | null>(null)
const proofOpen = ref(false)
const settingsOpen = ref(false)
const confirm = useConfirmDialog()
const toast = useToast()

function openNewForm() {
  editTarget.value = null
  formOpen.value = true
}

function onEdit(transaction: TransactionItem) {
  editTarget.value = transaction
  formOpen.value = true
}

// Al cerrar el formulario se descarta el objetivo de edición (volverá a modo alta).
watch(formOpen, (isOpen) => {
  if (!isOpen) editTarget.value = null
})

function onAttachProof(transactionId: string) {
  proofTarget.value = txData.value?.transactions.find(t => t.id === transactionId) ?? null
  proofOpen.value = true
}

async function onDelete(transaction: TransactionItem) {
  const confirmed = await confirm({
    title: 'Eliminar movimiento',
    description: `Se eliminará "${transaction.description}" (${formatEuros(transaction.amountCents)}). Los aportes vinculados quedarán pendientes de depósito.`,
    confirmLabel: 'Eliminar',
    color: 'error'
  })
  if (!confirmed) return

  try {
    await $fetch(`/api/bank/transactions/${transaction.id}`, { method: 'DELETE' })
    toast.add({ title: 'Movimiento eliminado', color: 'success' })
    await refreshAll()
  } catch {
    toast.add({ title: 'No se pudo eliminar el movimiento', color: 'error' })
  }
}

// ---- Filtros (en cliente, patrón del libro contable) ----
const periodFilter = ref<'all' | 'pre' | 'post'>('all')
const monthFilter = ref<string>('all')
const sortBy = ref<'date-asc' | 'date-desc' | 'amount-desc' | 'amount-asc'>('date-asc')

const purchaseDate = computed(() => settings.value?.purchaseDate ?? null)

const PERIOD_OPTIONS = computed(() => [
  { label: 'Todos los períodos', value: 'all' },
  { label: 'Pre-compra', value: 'pre', disabled: !purchaseDate.value },
  { label: 'Post-compra', value: 'post', disabled: !purchaseDate.value }
])

const SORT_OPTIONS = [
  { label: 'Fecha: antiguos primero', value: 'date-asc' },
  { label: 'Fecha: recientes primero', value: 'date-desc' },
  { label: 'Importe: mayor a menor', value: 'amount-desc' },
  { label: 'Importe: menor a mayor', value: 'amount-asc' }
]

const MONTH_OPTIONS = computed(() => {
  const months = [...new Set((txData.value?.transactions ?? []).map(t => t.date.slice(0, 7)))].sort().reverse()
  return [
    { label: 'Todos los meses', value: 'all' },
    ...months.map(m => ({
      label: new Date(`${m}-01T00:00:00`).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }),
      value: m
    }))
  ]
})

const filtered = computed(() => (txData.value?.transactions ?? []).filter((t) => {
  if (monthFilter.value !== 'all' && !t.date.startsWith(monthFilter.value)) return false
  if (periodFilter.value === 'pre' && (!purchaseDate.value || t.date >= purchaseDate.value)) return false
  if (periodFilter.value === 'post' && (!purchaseDate.value || t.date < purchaseDate.value)) return false
  return true
}))

// El endpoint devuelve la lista en orden de fecha (asc) con el saldo acumulado global (no
// filtrado). El "Saldo" de cada fila es una propiedad del movimiento — cuánto quedaba en
// la cuenta justo después — y sigue siendo correcto sea cual sea el orden elegido aquí.
const sorted = computed(() => {
  const list = [...filtered.value]
  switch (sortBy.value) {
    case 'date-desc': return list.reverse()
    case 'amount-desc': return list.sort((a, b) => b.amountCents - a.amountCents)
    case 'amount-asc': return list.sort((a, b) => a.amountCents - b.amountCents)
    default: return list
  }
})

const page = ref(1)
const ITEMS_PER_PAGE = 10
const pagedTransactions = computed(() => sorted.value.slice((page.value - 1) * ITEMS_PER_PAGE, page.value * ITEMS_PER_PAGE))
watch([periodFilter, monthFilter, sortBy, () => txData.value?.transactions.length], () => {
  page.value = 1
})
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-6 py-10">
    <div class="flex items-center justify-between gap-2">
      <h1 class="text-xl font-semibold">
        Cuenta bancaria
      </h1>
      <UButton
        v-if="isAdmin"
        icon="i-lucide-settings-2"
        color="neutral"
        variant="soft"
        @click="settingsOpen = true"
      >
        Configuración
      </UButton>
    </div>

    <BankReconciliationSummary
      v-if="summary"
      :current-cents="summary.currentCents"
      :pre-purchase-cents="summary.prePurchaseCents"
      :purchase-date="purchaseDate"
      :cash-pending-cents="summary.cashPendingCents"
      :cash-pending="summary.cashPending"
      :unmatched-deposits="summary.unmatchedDeposits"
    />

    <div class="flex items-center justify-between gap-2">
      <div class="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
        <USelect
          v-model="periodFilter"
          :items="PERIOD_OPTIONS"
          icon="i-lucide-calendar-range"
        />
        <USelect
          v-model="monthFilter"
          :items="MONTH_OPTIONS"
          icon="i-lucide-calendar"
        />
        <USelect
          v-model="sortBy"
          :items="SORT_OPTIONS"
          icon="i-lucide-arrow-down-up"
        />
      </div>
      <UButton
        v-if="isAdmin"
        icon="i-lucide-plus"
        @click="openNewForm"
      >
        Nuevo movimiento
      </UButton>
    </div>

    <p class="text-sm text-muted">
      {{ filtered.length }} {{ filtered.length === 1 ? 'movimiento' : 'movimientos' }}
    </p>

    <BankTransactionList
      :transactions="pagedTransactions"
      :is-admin="isAdmin"
      @attach-proof="onAttachProof"
      @edit="onEdit"
      @delete="onDelete"
    />

    <div
      v-if="filtered.length > ITEMS_PER_PAGE"
      class="flex justify-center"
    >
      <UPagination
        v-model:page="page"
        :total="filtered.length"
        :items-per-page="ITEMS_PER_PAGE"
      />
    </div>

    <BankTransactionForm
      v-model:open="formOpen"
      :transaction="editTarget"
      @saved="refreshAll"
    />

    <BankProofAttach
      v-model:open="proofOpen"
      :transaction-id="proofTarget?.id ?? null"
      :transaction-description="proofTarget?.description ?? ''"
      @attached="refreshAll"
    />

    <BankSettingsForm
      v-model:open="settingsOpen"
      :settings="settings ?? null"
      @saved="refreshAll"
    />
  </div>
</template>
