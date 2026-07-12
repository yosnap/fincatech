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

interface ExpenseDetail {
  id: string
  description: string
  amountCents: number
  type: string
  hasProof: boolean
  status: string
  createdBy?: string
  createdAt: string
  debts?: Debt[]
}

const route = useRoute()
const session = authClient.useSession()
const { data, refresh } = await useFetch<{ expense: ExpenseDetail }>(`/api/expenses/${route.params.id}`)

const currentUserId = computed(() => session.value.data?.user.id)
const currentUserRole = computed(() => (session.value.data?.user as { role?: string } | undefined)?.role)

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  pending_confirmation: 'Pendiente de confirmación',
  confirmed: 'Confirmado'
}

const proofFile = ref<File | null>(null)
const busyDebtId = ref<string | null>(null)
const errorMessage = ref('')

function formatEuros(cents: number) {
  return (cents / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  proofFile.value = input.files?.[0] ?? null
}

async function markPaid(debtId: string) {
  if (!proofFile.value) {
    errorMessage.value = 'Adjunta un comprobante (JPEG, PNG o PDF)'
    return
  }
  errorMessage.value = ''
  busyDebtId.value = debtId
  try {
    const formData = new FormData()
    formData.append('proof', proofFile.value)
    await $fetch(`/api/debts/${debtId}/mark-paid`, { method: 'POST', body: formData })
    proofFile.value = null
    await refresh()
  } catch {
    errorMessage.value = 'No se pudo marcar como pagado'
  } finally {
    busyDebtId.value = null
  }
}

async function confirmDebt(debtId: string) {
  errorMessage.value = ''
  busyDebtId.value = debtId
  try {
    await $fetch(`/api/debts/${debtId}/confirm`, { method: 'POST' })
    await refresh()
  } catch {
    errorMessage.value = 'No se pudo confirmar la cuota'
  } finally {
    busyDebtId.value = null
  }
}

async function viewProof(debtId: string) {
  const result = await $fetch<{ url: string }>(`/api/debts/${debtId}/proof`)
  window.open(result.url, '_blank')
}
</script>

<template>
  <div
    v-if="data"
    class="mx-auto flex max-w-2xl flex-col gap-6 py-10"
  >
    <UCard>
      <template #header>
        <h1 class="text-lg font-semibold">
          {{ data.expense.description }}
        </h1>
      </template>
      <p class="text-2xl font-semibold">
        {{ formatEuros(data.expense.amountCents) }}
      </p>
      <p class="text-sm text-muted">
        {{ data.expense.type === 'bank_receipt' ? 'Recibo bancario' : 'Gasto manual' }} ·
        {{ data.expense.hasProof ? 'Con comprobante' : 'Sin comprobante' }}
      </p>
    </UCard>

    <UAlert
      v-if="errorMessage"
      color="error"
      variant="soft"
      :title="errorMessage"
    />

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

          <div
            v-if="debt.status === 'pending' && debt.debtorId === currentUserId"
            class="flex items-center gap-2"
          >
            <input
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              class="text-sm"
              @change="onFileChange"
            >
            <UButton
              size="sm"
              :loading="busyDebtId === debt.id"
              @click="markPaid(debt.id)"
            >
              Marcar pagado
            </UButton>
          </div>

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
