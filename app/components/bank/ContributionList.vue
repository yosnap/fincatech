<script setup lang="ts">
// Listado de aportes con su estado de depósito: un aporte en efectivo aparece "pendiente
// de depósito" hasta que se vincula al ingreso bancario real; luego "depositado".

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

defineProps<{
  contributions: ContributionItem[]
  isAdmin: boolean
  currentUserId: string
}>()

const emit = defineEmits<{
  link: [contribution: ContributionItem]
  unlink: [contribution: ContributionItem]
  delete: [contribution: ContributionItem]
}>()

const TYPE_LABELS: Record<string, string> = {
  pre_purchase: 'Pre-compra',
  quota: 'Cuota',
  extraordinary: 'Extraordinario'
}

const METHOD_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia'
}
</script>

<template>
  <UCard>
    <div class="flex flex-col divide-y divide-default">
      <div
        v-for="contribution in contributions"
        :key="contribution.id"
        class="flex items-center justify-between gap-2 py-3"
      >
        <div class="min-w-0">
          <p class="font-medium">
            {{ contribution.memberName }}
            <span class="font-normal text-muted">
              · {{ TYPE_LABELS[contribution.type] ?? contribution.type }}
              <template v-if="contribution.period">
                · {{ contribution.period }}
              </template>
              · {{ METHOD_LABELS[contribution.method] ?? contribution.method }}
            </span>
          </p>
          <p class="flex flex-wrap items-center gap-1.5 text-sm text-muted">
            {{ new Date(contribution.date).toLocaleDateString('es-ES') }}
            <template v-if="contribution.registeredBy !== contribution.memberId">
              · registrado por {{ contribution.registeredByName }}
            </template>
            <template v-if="contribution.notes">
              · {{ contribution.notes }}
            </template>
          </p>
        </div>

        <div class="flex shrink-0 items-center gap-1.5">
          <UBadge
            :color="contribution.bankTransactionId ? 'success' : (contribution.method === 'cash' ? 'warning' : 'neutral')"
            variant="soft"
            size="sm"
          >
            {{ contribution.bankTransactionId ? 'Depositado' : (contribution.method === 'cash' ? 'Pendiente de depósito' : 'Sin movimiento') }}
          </UBadge>

          <UButton
            v-if="!contribution.bankTransactionId && isAdmin"
            icon="i-lucide-link"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Vincular a ingreso bancario"
            title="Vincular a ingreso bancario"
            @click="emit('link', contribution)"
          />
          <UButton
            v-else-if="contribution.bankTransactionId && isAdmin"
            icon="i-lucide-unlink"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Desvincular del ingreso"
            title="Desvincular del ingreso"
            @click="emit('unlink', contribution)"
          />

          <UButton
            v-if="isAdmin || contribution.registeredBy === currentUserId"
            icon="i-lucide-trash-2"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Eliminar aporte"
            title="Eliminar aporte"
            @click="emit('delete', contribution)"
          />
        </div>
      </div>
      <p
        v-if="!contributions.length"
        class="py-6 text-center text-muted"
      >
        Sin aportes registrados
      </p>
    </div>
  </UCard>
</template>
