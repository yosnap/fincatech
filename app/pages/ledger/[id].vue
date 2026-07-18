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

interface ParticipantWithName extends ParticipantShare {
  name: string
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
  participants?: ParticipantWithName[]
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
// Admin elimina cualquiera; Propietario solo los suyos.
const canDeleteExpense = computed(() => {
  if (currentUserRole.value === 'admin') return true
  return currentUserRole.value === 'owner' && data.value?.expense.createdBy === currentUserId.value
})
const hasPaymentTrace = computed(() => {
  const debtList = data.value?.expense.debts
  return !!debtList && debtList.some(d => d.status !== 'pending')
})
// Igual que el borrado: solo se puede tocar el reparto/pagador mientras ninguna cuota tenga
// rastro de pago — evita romper un pago real ya hecho.
const canEditParticipants = computed(() => currentUserRole.value === 'admin' && !hasPaymentTrace.value)
const canReassignCreator = computed(() => currentUserRole.value === 'admin' && !hasPaymentTrace.value)

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

async function markPaidWithoutProof(debtId: string) {
  const confirmed = await useConfirmDialog()({
    title: 'Marcar como pagado sin comprobante',
    description: 'Quedará pendiente de que la otra persona (o un Admin) confirme que lo recibió.',
    confirmLabel: 'Marcar como pagado',
    color: 'primary'
  })
  if (!confirmed) return

  busyDebtId.value = debtId
  try {
    await $fetch(`/api/debts/${debtId}/mark-paid`, { method: 'POST' })
    await refresh()
    toast.add({ title: 'Marcado como pagado, pendiente de confirmación', color: 'success' })
  } catch {
    toast.add({ title: 'No se pudo marcar como pagado', color: 'error' })
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

const membersData = ref<{ members: Member[] } | null>(null)

async function ensureMembersLoaded() {
  if (!membersData.value) {
    membersData.value = await $fetch<{ members: Member[] }>('/api/expenses/participants')
  }
}

const editingParticipants = ref(false)
const savingParticipants = ref(false)
const selectedParticipantIds = ref<string[]>([])

async function openEditParticipants() {
  await ensureMembersLoaded()
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

const editingCreator = ref(false)
const savingCreator = ref(false)
const selectedCreatorId = ref<string>('')

async function openReassignCreator() {
  await ensureMembersLoaded()
  selectedCreatorId.value = data.value?.expense.createdBy ?? ''
  editingCreator.value = true
}

async function saveCreator() {
  if (!selectedCreatorId.value) return
  savingCreator.value = true
  try {
    await $fetch(`/api/expenses/${route.params.id}/creator`, {
      method: 'PATCH',
      body: { userId: selectedCreatorId.value }
    })
    editingCreator.value = false
    await refresh()
    toast.add({ title: 'Pagador reasignado', color: 'success' })
  } catch (error) {
    const statusMessage = (error as { data?: { statusMessage?: string } })?.data?.statusMessage
    toast.add({ title: statusMessage ?? 'No se pudo reasignar el pagador', color: 'error' })
  } finally {
    savingCreator.value = false
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
          v-if="canReassignCreator && !editingCreator"
          icon="i-lucide-user-cog"
          variant="ghost"
          color="neutral"
          size="sm"
          @click="openReassignCreator"
        >
          Reasignar pagador
        </UButton>
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

    <UCard v-if="editingCreator">
      <template #header>
        <h2 class="text-lg font-semibold">
          Reasignar pagador
        </h2>
      </template>
      <p class="mb-2 text-sm text-muted">
        Si el nuevo pagador no era participante, se añade automáticamente al reparto.
      </p>
      <USelect
        v-model="selectedCreatorId"
        :items="(membersData?.members ?? []).map(m => ({ label: m.name, value: m.id }))"
        class="w-full"
      />
      <div class="mt-4 flex gap-2">
        <UButton
          :loading="savingCreator"
          @click="saveCreator"
        >
          Guardar
        </UButton>
        <UButton
          variant="soft"
          color="neutral"
          @click="editingCreator = false"
        >
          Cancelar
        </UButton>
      </div>
    </UCard>

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

    <UCard v-if="data.expense.participants">
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon
            name="i-lucide-users"
            class="size-5 text-primary"
          />
          <h2 class="text-lg font-semibold">
            Participantes ({{ data.expense.participants.length }})
          </h2>
        </div>
      </template>
      <div class="flex flex-col divide-y divide-default">
        <div
          v-for="participant in data.expense.participants"
          :key="participant.userId"
          class="flex items-center justify-between py-2 text-sm"
        >
          <p>
            {{ participant.name }}
            <span
              v-if="participant.userId === data.expense.createdBy"
              class="text-muted"
            >(pagador)</span>
          </p>
          <p class="font-medium">
            {{ formatEuros(participant.amountCents) }}
          </p>
        </div>
      </div>
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

          <template v-if="debt.status === 'pending' && debt.debtorId === currentUserId">
            <MediaPhotoUpload
              :upload-url="`/api/debts/${debt.id}/mark-paid`"
              field-name="proof"
              accept="image/jpeg,image/png,application/pdf"
              label="Adjunta el comprobante de pago"
              description="JPEG, PNG o PDF, máx. 10MB — al subirlo se marca la cuota como pagada"
              :compress="false"
              @uploaded="refresh"
            />
            <UButton
              size="xs"
              variant="link"
              class="self-start px-0"
              :loading="busyDebtId === debt.id"
              @click="markPaidWithoutProof(debt.id)"
            >
              O marca como pagado sin comprobante
            </UButton>
          </template>

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
