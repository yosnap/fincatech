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
  createdAt: string
  debts?: DebtSummary[]
}

const session = authClient.useSession()
const { data, refresh } = await useFetch<{ expenses: ExpenseItem[] }>('/api/expenses')

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  partial: 'Pago parcial',
  settled: 'Liquidado'
}

const canCreate = computed(() => {
  const role = (session.value.data?.user as { role?: string } | undefined)?.role
  return role === 'admin' || role === 'owner'
})

function formatEuros(cents: number) {
  return (cents / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })
}
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-6 py-10">
    <h1 class="text-xl font-semibold">
      Libro contable
    </h1>

    <ExpenseForm
      v-if="canCreate"
      @created="refresh"
    />

    <UCard>
      <div class="flex flex-col divide-y divide-default">
        <NuxtLink
          v-for="expense in data?.expenses ?? []"
          :key="expense.id"
          :to="`/ledger/${expense.id}`"
          class="flex items-center justify-between py-3"
        >
          <div>
            <p class="font-medium">
              {{ expense.description }}
            </p>
            <p class="text-sm text-muted">
              {{ new Date(expense.createdAt).toLocaleDateString('es-ES') }}
            </p>
          </div>
          <div class="text-right">
            <p class="font-medium">
              {{ formatEuros(expense.amountCents) }}
            </p>
            <UBadge variant="soft">
              {{ STATUS_LABELS[expense.status] ?? expense.status }}
            </UBadge>
          </div>
        </NuxtLink>
        <p
          v-if="!data?.expenses?.length"
          class="py-6 text-center text-muted"
        >
          Sin gastos todavía
        </p>
      </div>
    </UCard>
  </div>
</template>
