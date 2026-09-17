<script setup lang="ts">
// Tabla de movimientos bancarios: columnas alineadas (fecha, descripción, importe y saldo
// a la derecha con cifras tabulares) y badge de justificante en sus tres estados —
// presente (abre la URL firmada), ausente y acción de adjuntar (admin).

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

defineProps<{
  transactions: TransactionItem[]
  isAdmin: boolean
}>()

const emit = defineEmits<{
  attachProof: [transactionId: string]
  edit: [transaction: TransactionItem]
  delete: [transaction: TransactionItem]
}>()

const CATEGORY_LABELS: Record<string, string> = {
  hacienda: 'Hacienda',
  ayuntamiento: 'Ayuntamiento',
  impuestos: 'Impuestos',
  iva: 'Compensación IVA',
  otro: 'Otro'
}

const openingProof = ref(false)

// El justificante se abre en pestaña nueva vía URL firmada de 5 minutos.
async function openProof(transactionId: string) {
  openingProof.value = true
  try {
    const { url } = await $fetch<{ url: string }>(`/api/bank/transactions/${transactionId}/proof`)
    window.open(url, '_blank')
  } catch {
    useToast().add({ title: 'No se pudo abrir el justificante', color: 'error' })
  } finally {
    openingProof.value = false
  }
}
</script>

<template>
  <UCard>
    <div class="overflow-x-auto">
      <table class="w-full min-w-[620px] text-sm">
        <thead>
          <tr class="border-b border-default text-left text-xs uppercase tracking-wide text-muted">
            <th class="pb-2 pr-4 font-medium">
              Fecha
            </th>
            <th class="pb-2 pr-4 font-medium">
              Descripción
            </th>
            <th class="pb-2 pl-4 text-right font-medium">
              Importe
            </th>
            <th class="pb-2 pl-4 text-right font-medium">
              Saldo
            </th>
            <th class="pb-2 pl-4 text-center font-medium">
              Justificante
            </th>
            <th
              v-if="isAdmin"
              class="pb-2 pl-4 text-center font-medium"
              colspan="2"
            >
              Acciones
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="transaction in transactions"
            :key="transaction.id"
            class="border-b border-default last:border-0"
          >
            <td class="py-3 pr-4 whitespace-nowrap text-muted">
              <UIcon
                :name="transaction.direction === 'deposit' ? 'i-lucide-arrow-down-circle' : 'i-lucide-arrow-up-circle'"
                class="mr-1 size-3.5 align-[-2px]"
                :class="transaction.direction === 'deposit' ? 'text-success' : 'text-error'"
              />
              {{ new Date(transaction.date).toLocaleDateString('es-ES') }}
            </td>

            <td class="py-3 pr-4 font-medium">
              <span class="block truncate">{{ transaction.description }}</span>
              <UBadge
                v-if="transaction.category"
                color="neutral"
                variant="subtle"
                size="sm"
                class="mt-0.5"
              >
                {{ CATEGORY_LABELS[transaction.category] ?? transaction.category }}
              </UBadge>
            </td>

            <td
              class="py-3 pl-4 text-right font-medium whitespace-nowrap tabular-nums"
              :class="transaction.direction === 'deposit' ? 'text-success' : 'text-error'"
            >
              {{ transaction.direction === 'deposit' ? '+' : '−' }}{{ formatEuros(transaction.amountCents) }}
            </td>

            <td class="py-3 pl-4 text-right whitespace-nowrap text-muted tabular-nums">
              {{ formatEuros(transaction.balanceCentsAfter) }}
            </td>

            <td class="py-3 pl-4 text-center">
              <UButton
                v-if="transaction.hasProof"
                icon="i-lucide-file-check-2"
                color="success"
                variant="ghost"
                size="sm"
                :loading="openingProof"
                aria-label="Ver justificante"
                title="Ver justificante"
                @click="openProof(transaction.id)"
              />
              <UButton
                v-else-if="isAdmin"
                icon="i-lucide-file-plus-2"
                color="neutral"
                variant="ghost"
                size="sm"
                aria-label="Adjuntar justificante"
                title="Adjuntar justificante"
                @click="emit('attachProof', transaction.id)"
              />
              <span
                v-else
                class="text-dimmed"
                title="Sin justificante"
              >—</span>
            </td>

            <td
              v-if="isAdmin"
              class="py-3 pl-4 text-center"
            >
              <UButton
                icon="i-lucide-pencil"
                color="neutral"
                variant="ghost"
                size="sm"
                aria-label="Editar movimiento"
                title="Editar movimiento"
                @click="emit('edit', transaction)"
              />
            </td>
            <td
              v-if="isAdmin"
              class="py-3 pl-2 text-center"
            >
              <UButton
                icon="i-lucide-trash-2"
                color="neutral"
                variant="ghost"
                size="sm"
                aria-label="Eliminar movimiento"
                title="Eliminar movimiento"
                @click="emit('delete', transaction)"
              />
            </td>
          </tr>
          <tr v-if="!transactions.length">
            <td
              :colspan="isAdmin ? 6 : 5"
              class="py-8 text-center text-muted"
            >
              Sin movimientos con estos filtros
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </UCard>
</template>
