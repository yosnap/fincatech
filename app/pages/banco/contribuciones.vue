<script setup lang="ts">
import { authClient } from '~/utils/auth-client'

definePageMeta({ middleware: ['auth'] })

interface LinkedTransaction {
  id: string
  date: string
  amountCents: number
  description: string
}

interface ContributionItem {
  id: string
  memberId: string
  memberName: string
  amountCents: number
  type: string
  period: string | null
  method: string
  date: string
  bankTransactionId: string | null
  bankTransaction: LinkedTransaction | null
  registeredBy: string
  registeredByName: string
  notes: string | null
}

interface QuotaContribution {
  id: string
  memberId: string
  period: string | null
}

interface QuotaCellState {
  memberId: string
  contribution: QuotaContribution | null
}

interface QuotaMonthState {
  period: string
  isFuture: boolean
  cells: QuotaCellState[]
}

interface QuotaGridResponse {
  settings: { purchaseDate: string | null, quotaAmountCents: number | null, quotaStartMonth: string | null }
  activeMembers: { id: string, name: string }[]
  months: QuotaMonthState[]
}

interface TransactionItem {
  id: string
  date: string
  direction: string
  amountCents: number
  description: string
  category: string | null
}

const session = authClient.useSession()
const sessionUser = computed(() => session.value.data?.user as { id?: string, role?: string } | undefined)
const currentUserId = computed(() => sessionUser.value?.id ?? '')
const role = computed(() => sessionUser.value?.role)
const isAdmin = computed(() => role.value === 'admin')
// El Invitado no ve el grid ni los aportes de otros miembros: solo los suyos (el endpoint
// ya filtra) y sin desglose colectivo.
const isGuest = computed(() => role.value === 'guest')

const { data: contributionsData, refresh: refreshContributions } = await useFetch<{ contributions: ContributionItem[] }>('/api/bank/contributions')
const { data: quotaGrid, refresh: refreshQuotaGrid } = await useFetch<QuotaGridResponse>('/api/bank/contributions/grid')
const { data: txData, refresh: refreshTransactions } = await useFetch<{ transactions: TransactionItem[] }>('/api/bank/transactions')

// Incluye los movimientos: el LinkDepositDialog lista depósitos a partir de ellos y una
// vinculación reciente cambia qué queda "sin aporte asociado".
async function refreshAll() {
  await Promise.all([refreshContributions(), refreshQuotaGrid(), refreshTransactions()])
}

const allContributions = computed(() => contributionsData.value?.contributions ?? [])
const quotaContributions = computed(() => allContributions.value.filter(c => c.type === 'quota'))
const prePurchaseContributions = computed(() => allContributions.value.filter(c => c.type === 'pre_purchase'))
const extraordinaryContributions = computed(() => allContributions.value.filter(c => c.type === 'extraordinary'))

// ---- Registro de aportes ----
const formOpen = ref(false)
const formPreset = ref<{ memberId?: string, period?: string, type?: 'quota' | 'pre_purchase' | 'extraordinary' }>({})
const confirm = useConfirmDialog()
const toast = useToast()

function openForm(preset: { memberId?: string, period?: string, type?: 'quota' | 'pre_purchase' | 'extraordinary' } = {}) {
  formPreset.value = preset
  formOpen.value = true
}

function onGridRegister(memberId: string, period: string) {
  openForm({ memberId, period, type: 'quota' })
}

// ---- Vinculación ----
const linkTarget = ref<ContributionItem | null>(null)
const linkOpen = ref(false)

function onLink(contribution: ContributionItem) {
  linkTarget.value = contribution
  linkOpen.value = true
}

async function onUnlink(contribution: ContributionItem) {
  const confirmed = await confirm({
    title: 'Desvincular aporte',
    description: `El aporte de ${contribution.memberName} volverá a "pendiente de depósito". El ingreso bancario no se toca.`,
    confirmLabel: 'Desvincular',
    color: 'error'
  })
  if (!confirmed) return

  try {
    await $fetch(`/api/bank/contributions/${contribution.id}`, {
      method: 'PATCH',
      body: { bankTransactionId: null }
    })
    toast.add({ title: 'Aporte desvinculado', color: 'success' })
    await refreshAll()
  } catch {
    toast.add({ title: 'No se pudo desvincular el aporte', color: 'error' })
  }
}

async function onDelete(contribution: ContributionItem) {
  const confirmed = await confirm({
    title: 'Eliminar aporte',
    description: `Se eliminará el aporte de ${contribution.memberName} (${formatEuros(contribution.amountCents)}). El movimiento bancario vinculado no se toca: si queda sin origen, aparecerá en las alertas del resumen.`,
    confirmLabel: 'Eliminar',
    color: 'error'
  })
  if (!confirmed) return

  try {
    await $fetch(`/api/bank/contributions/${contribution.id}`, { method: 'DELETE' })
    toast.add({ title: 'Aporte eliminado', color: 'success' })
    await Promise.all([refreshAll(), refreshQuotaGrid()])
  } catch {
    toast.add({ title: 'No se pudo eliminar el aporte', color: 'error' })
  }
}

const TABS = computed(() => {
  const tabs = [
    { label: 'Cuotas mensuales', value: 'quota' as const },
    { label: 'Pre-compra', value: 'pre_purchase' as const },
    { label: 'Extraordinarias', value: 'extraordinary' as const }
  ]
  return tabs
})

const activeTab = ref<'quota' | 'pre_purchase' | 'extraordinary'>('quota')
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-6 py-10">
    <div class="flex items-center justify-between gap-2">
      <h1 class="text-xl font-semibold">
        Contribuciones
      </h1>
      <UButton
        v-if="!isGuest"
        icon="i-lucide-plus"
        @click="openForm()"
      >
        Registrar aporte
      </UButton>
    </div>

    <p class="text-sm text-muted">
      Aportaciones de los miembros a la copropiedad: cuotas mensuales, aportes pre-compra
      históricos y extraordinarios. El efectivo entregado queda pendiente de depósito hasta
      vincularlo al ingreso bancario real.
    </p>

    <template v-if="!isGuest">
      <UTabs
        v-model="activeTab"
        :items="TABS"
      />

      <template v-if="activeTab === 'quota'">
        <BankMonthlyQuotaGrid
          :members="quotaGrid?.activeMembers ?? []"
          :months="quotaGrid?.months ?? []"
          :can-register="true"
          @register="onGridRegister"
        />
        <BankContributionList
          :contributions="quotaContributions"
          :is-admin="isAdmin"
          :current-user-id="currentUserId"
          @link="onLink"
          @unlink="onUnlink"
          @delete="onDelete"
        />
      </template>

      <template v-else-if="activeTab === 'pre_purchase'">
        <BankContributionList
          :contributions="prePurchaseContributions"
          :is-admin="isAdmin"
          :current-user-id="currentUserId"
          @link="onLink"
          @unlink="onUnlink"
          @delete="onDelete"
        />
      </template>

      <template v-else>
        <BankContributionList
          :contributions="extraordinaryContributions"
          :is-admin="isAdmin"
          :current-user-id="currentUserId"
          @link="onLink"
          @unlink="onUnlink"
          @delete="onDelete"
        />
      </template>
    </template>

    <template v-else>
      <p class="text-sm text-muted">
        Aquí ves solo tus propias contribuciones.
      </p>
      <BankContributionList
        :contributions="allContributions"
        :is-admin="false"
        :current-user-id="currentUserId"
        @delete="onDelete"
      />
    </template>

    <BankContributionForm
      v-model:open="formOpen"
      :members="quotaGrid?.activeMembers ?? []"
      :is-admin="isAdmin"
      :current-user-id="currentUserId"
      :quota-amount-cents="quotaGrid?.settings.quotaAmountCents ?? null"
      :initial-member-id="formPreset.memberId"
      :initial-period="formPreset.period"
      :initial-type="formPreset.type"
      @created="refreshAll"
    />

    <BankLinkDepositDialog
      v-model:open="linkOpen"
      :contribution="linkTarget"
      :transactions="txData?.transactions ?? []"
      @linked="refreshAll"
    />
  </div>
</template>
