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
  taxCents: number | null
  type: string
  hasProof: boolean
  status: string
  createdBy?: string
  createdAt: string
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

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  pending_confirmation: 'Pendiente de confirmación',
  confirmed: 'Confirmado'
}

const busyDebtId = ref<string | null>(null)
const errorMessage = ref('')

function formatEuros(cents: number) {
  return (cents / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })
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
    <UButton
      icon="i-lucide-arrow-left"
      variant="ghost"
      color="neutral"
      size="sm"
      class="self-start"
      to="/ledger"
    >
      Volver
    </UButton>
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

          <MediaPhotoUpload
            v-if="debt.status === 'pending' && debt.debtorId === currentUserId"
            :upload-url="`/api/debts/${debt.id}/mark-paid`"
            field-name="proof"
            accept="image/jpeg,image/png,application/pdf"
            label="Adjunta el comprobante de pago"
            description="JPEG, PNG o PDF, máx. 10MB — al subirlo se marca la cuota como pagada"
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
