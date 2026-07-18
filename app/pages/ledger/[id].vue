<script setup lang="ts">
import { authClient } from '~/utils/auth-client'

definePageMeta({ middleware: ['auth'] })

interface Debt {
  id: string
  debtorId: string
  creditorId: string
  amountCents: number
  status: string
}

interface Member {
  id: string
  name: string
  role: string
}

interface ParticipantShare {
  userId: string
  amountCents: number
}

interface ExpenseDetail {
  id: string
  description: string
  amountCents: number
  taxCents: number | null
  type: string
  hasProof: boolean
  hasStoredProof: boolean
  status: string
  createdBy?: string
  createdByName: string
  createdAt: string
  participantSnapshot?: ParticipantShare[]
  debts?: Debt[]
}

const TYPE_LABELS: Record<string, string> = {
  manual: 'Gasto manual',
  bank_receipt: 'Recibo bancario',
  derrama: 'Derrama'
}

const route = useRoute()
const session = authClient.useSession()
const { data, refresh } = await useFetch<{ expense: ExpenseDetail }>(`/api/expenses/${route.params.id}`)

const currentUserId = computed(() => session.value.data?.user.id)
const currentUserRole = computed(() => (session.value.data?.user as { role?: string } | undefined)?.role)
const canSeeExpenseProof = computed(() => currentUserRole.value === 'admin' || currentUserRole.value === 'owner')
const canDeleteExpense = computed(() => currentUserRole.value === 'admin')
// Igual que el borrado: solo se puede tocar el reparto mientras ninguna cuota tenga rastro
// de pago — evita romper un pago real ya hecho.
const canEditParticipants = computed(() => {
  if (currentUserRole.value !== 'admin') return false
  const debtList = data.value?.expense.debts
  return !debtList || debtList.every(d => d.status === 'pending')
})

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  pending_confirmation: 'Pendiente de confirmación',
  confirmed: 'Confirmado'
}

const busyDebtId = ref<string | null>(null)
const toast = useToast()

async function confirmDebt(debtId: string) {
  busyDebtId.value = debtId
  try {
    await $fetch(`/api/debts/${debtId}/confirm`, { method: 'POST' })
    await refresh()
    toast.add({ title: 'Cuota confirmada', color: 'success' })
  } catch {
    toast.add({ title: 'No se pudo confirmar la cuota', color: 'error' })
  } finally {
    busyDebtId.value = null
  }
}

async function viewProof(debtId: string) {
  const result = await $fetch<{ url: string }>(`/api/debts/${debtId}/proof`)
  window.open(result.url, '_blank')
}

const viewingExpenseProof = ref(false)

async function viewExpenseProof() {
  viewingExpenseProof.value = true
  try {
    const result = await $fetch<{ url: string }>(`/api/expenses/${route.params.id}/proof`)
    window.open(result.url, '_blank')
  } catch {
    toast.add({ title: 'Este gasto no tiene justificante subido', color: 'warning' })
  } finally {
    viewingExpenseProof.value = false
  }
}

const deleting = ref(false)

async function onDeleteExpense() {
  const confirmed = await useConfirmDialog()({
    title: 'Eliminar gasto',
    description: 'No se puede deshacer. Solo es posible si ninguna cuota tiene pagos registrados.',
    confirmLabel: 'Eliminar',
    color: 'error'
  })
  if (!confirmed) return

  deleting.value = true
  try {
    const deleteUrl: string = `/api/expenses/${route.params.id}`
    await $fetch(deleteUrl, { method: 'DELETE' })
    toast.add({ title: 'Gasto eliminado', color: 'success' })
    await navigateTo('/ledger')
  } catch (error) {
    const statusMessage = (error as { data?: { statusMessage?: string } })?.data?.statusMessage
    toast.add({ title: statusMessage ?? 'No se pudo eliminar el gasto', color: 'error' })
  } finally {
    deleting.value = false
  }
}

const editingParticipants = ref(false)
const savingParticipants = ref(false)
const selectedParticipantIds = ref<string[]>([])
const membersData = ref<{ members: Member[] } | null>(null)

async function openEditParticipants() {
  if (!membersData.value) {
    membersData.value = await $fetch<{ members: Member[] }>('/api/expenses/participants')
  }
  selectedParticipantIds.value = (data.value?.expense.participantSnapshot ?? []).map(s => s.userId)
  editingParticipants.value = true
}

function toggleParticipant(memberId: string, checked: boolean) {
  selectedParticipantIds.value = checked
    ? [...selectedParticipantIds.value, memberId]
    : selectedParticipantIds.value.filter(id => id !== memberId)
}

async function saveParticipants() {
  if (selectedParticipantIds.value.length === 0) {
    toast.add({ title: 'Selecciona al menos un participante', color: 'warning' })
    return
  }
  savingParticipants.value = true
  try {
    await $fetch(`/api/expenses/${route.params.id}/participants`, {
      method: 'PATCH',
      body: { participantIds: selectedParticipantIds.value }
    })
    editingParticipants.value = false
    await refresh()
    toast.add({ title: 'Participantes actualizados', color: 'success' })
  } catch (error) {
    const statusMessage = (error as { data?: { statusMessage?: string } })?.data?.statusMessage
    toast.add({ title: statusMessage ?? 'No se pudieron actualizar los participantes', color: 'error' })
  } finally {
    savingParticipants.value = false
  }
}
</script>

<template>
  <div
    v-if="data"
    class="mx-auto flex max-w-2xl flex-col gap-6 py-10"
  >
    <div class="flex items-center justify-between">
      <UButton
        icon="i-lucide-arrow-left"
        variant="ghost"
        color="neutral"
        size="sm"
        to="/ledger"
      >
        Volver
      </UButton>
      <div class="flex gap-2">
        <UButton
          v-if="canEditParticipants && !editingParticipants"
          icon="i-lucide-users"
          variant="ghost"
          color="neutral"
          size="sm"
          @click="openEditParticipants"
        >
          Editar participantes
        </UButton>
        <UButton
          v-if="canDeleteExpense"
          icon="i-lucide-trash-2"
          variant="ghost"
          color="error"
          size="sm"
          :loading="deleting"
          @click="onDeleteExpense"
        >
          Eliminar gasto
        </UButton>
      </div>
    </div>

    <UCard v-if="editingParticipants">
      <template #header>
        <h2 class="text-lg font-semibold">
          Editar participantes
        </h2>
      </template>
      <div class="flex flex-col gap-2">
        <UCheckbox
          v-for="member in membersData?.members ?? []"
          :key="member.id"
          :model-value="selectedParticipantIds.includes(member.id)"
          :label="member.name"
          @update:model-value="(checked) => toggleParticipant(member.id, checked === true)"
        />
      </div>
      <div class="mt-4 flex gap-2">
        <UButton
          :loading="savingParticipants"
          @click="saveParticipants"
        >
          Guardar
        </UButton>
        <UButton
          variant="soft"
          color="neutral"
          @click="editingParticipants = false"
        >
          Cancelar
        </UButton>
      </div>
    </UCard>
    <UCard>
      <template #header>
        <h1 class="text-lg font-semibold">
          {{ data.expense.description }}
        </h1>
      </template>
      <p class="text-2xl font-semibold">
        {{ formatEuros(data.expense.amountCents) }}
      </p>
      <p
        v-if="data.expense.taxCents != null"
        class="text-sm text-muted"
      >
        de los cuales IVA/impuestos: {{ formatEuros(data.expense.taxCents) }}
      </p>
      <p class="text-sm text-muted">
        {{ TYPE_LABELS[data.expense.type] ?? data.expense.type }} ·
        {{ data.expense.hasProof ? 'Con comprobante' : 'Sin comprobante' }} ·
        dado de alta por {{ data.expense.createdByName }}
      </p>
      <UButton
        v-if="canSeeExpenseProof && data.expense.hasStoredProof"
        size="xs"
        variant="link"
        class="self-start px-0"
        :loading="viewingExpenseProof"
        @click="viewExpenseProof"
      >
        Ver justificante
      </UButton>
    </UCard>

    <UCard v-if="data.expense.debts">
      <template #header>
        <h2 class="text-lg font-semibold">
          Cuotas
        </h2>
      </template>

      <div class="flex flex-col divide-y divide-default">
        <div
          v-for="debt in data.expense.debts"
          :key="debt.id"
          class="flex flex-col gap-2 py-3"
        >
          <div class="flex items-center justify-between">
            <p class="font-medium">
              {{ formatEuros(debt.amountCents) }}
            </p>
            <UBadge variant="soft">
              {{ STATUS_LABELS[debt.status] ?? debt.status }}
            </UBadge>
          </div>

          <div
            v-if="debt.status !== 'pending'"
            class="flex justify-end"
          >
            <UButton
              size="xs"
              variant="link"
              @click="viewProof(debt.id)"
            >
              Ver comprobante
            </UButton>
          </div>

          <MediaPhotoUpload
            v-if="debt.status === 'pending' && debt.debtorId === currentUserId"
            :upload-url="`/api/debts/${debt.id}/mark-paid`"
            field-name="proof"
            accept="image/jpeg,image/png,application/pdf"
            label="Adjunta el comprobante de pago"
            description="JPEG, PNG o PDF, máx. 10MB — al subirlo se marca la cuota como pagada"
            :compress="false"
            @uploaded="refresh"
          />

          <div
            v-if="debt.status === 'pending_confirmation' && (debt.creditorId === currentUserId || currentUserRole === 'admin')"
            class="flex justify-end"
          >
            <UButton
              size="sm"
              color="success"
              :loading="busyDebtId === debt.id"
              @click="confirmDebt(debt.id)"
            >
              Confirmar recepción
            </UButton>
          </div>
        </div>
        <p
          v-if="!data.expense.debts.length"
          class="py-4 text-center text-sm text-muted"
        >
          Sin cuotas — gasto individual, no se repartió con nadie más.
        </p>
      </div>
    </UCard>

    <UAlert
      v-else
      color="neutral"
      variant="soft"
      title="Vista agregada: el desglose individual no está disponible para tu rol."
    />
  </div>
</template>
