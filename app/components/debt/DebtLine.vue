<script setup lang="ts">
import type { DebtSummaryItem } from './DebtList.vue'

const props = defineProps<{
  line: DebtSummaryItem
  side: 'debtor' | 'creditor'
  // En vista agrupada el nombre de la persona ya está en la cabecera del grupo.
  showCounterparty: boolean
  busyId: string | null
  // Origen de navegación: el detalle del gasto devuelve "Volver" a esta página (?from=).
  origin?: 'dashboard' | 'ledger' | 'liquidacion'
}>()

const emit = defineEmits<{
  'confirm': [debtId: string]
  'mark-paid': [debtId: string]
  'refresh': []
}>()

const DEBT_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  pending_confirmation: 'Pendiente de confirmación'
}

const detailLink = computed(() => {
  const from = props.origin && props.origin !== 'ledger' ? `?from=${props.origin}` : ''
  return `/ledger/${props.line.expenseId}${from}`
})
</script>

<template>
  <div class="flex flex-col gap-2 py-2 text-sm">
    <div class="flex items-center justify-between gap-2">
      <NuxtLink
        :to="detailLink"
        class="font-medium hover:underline"
      >
        {{ line.expenseDescription }}
      </NuxtLink>
      <p class="shrink-0 font-medium">
        {{ formatEuros(line.amountCents) }}
      </p>
    </div>
    <div class="flex items-center justify-between gap-2">
      <p class="text-muted">
        <template v-if="showCounterparty">
          {{ side === 'debtor' ? `A ${line.counterpartyName}` : line.counterpartyName }} ·
        </template>
        {{ DEBT_STATUS_LABELS[line.status] ?? line.status }} ·
        {{ new Date(line.createdAt).toLocaleDateString('es-ES') }}
      </p>
      <UButton
        v-if="side === 'creditor' && line.status === 'pending_confirmation'"
        size="xs"
        color="success"
        :loading="busyId === line.id"
        @click="emit('confirm', line.id)"
      >
        Confirmar recepción
      </UButton>
    </div>
    <template v-if="side === 'debtor' && line.status === 'pending'">
      <MediaPhotoUpload
        :upload-url="`/api/debts/${line.id}/mark-paid`"
        field-name="proof"
        accept="image/jpeg,image/png,application/pdf"
        label="Adjunta el comprobante"
        description="JPEG, PNG o PDF, máx. 10MB — al subirlo se marca como pagada"
        :compress="false"
        @uploaded="emit('refresh')"
      />
      <UButton
        size="xs"
        variant="link"
        class="self-start px-0"
        :loading="busyId === line.id"
        @click="emit('mark-paid', line.id)"
      >
        O marca como pagado sin comprobante
      </UButton>
    </template>
  </div>
</template>
