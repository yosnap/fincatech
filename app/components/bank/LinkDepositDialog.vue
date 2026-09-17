<script setup lang="ts">
// Vincula un aporte en efectivo (pendiente de depósito) a un ingreso bancario existente.
// Solo se ofrecen depósitos sin categoría externa: un ingreso categorizado (Hacienda,
// IVA…) es por definición dinero que no viene de un miembro.

interface ContributionItem {
  id: string
  memberName: string
  amountCents: number
  date: string
}

interface TransactionItem {
  id: string
  date: string
  direction: string
  amountCents: number
  description: string
  category: string | null
}

const props = defineProps<{
  contribution: ContributionItem | null
  transactions: TransactionItem[]
}>()

const emit = defineEmits<{ linked: [] }>()

const open = defineModel<boolean>('open', { default: false })

// Centinela NO vacío para la opción por defecto del selector: un item de USelect con
// value '' impide que UModal se desmonte al cerrar (bug de reka-ui/Nuxt UI, ver
// TransactionForm.vue).
const NO_DEPOSIT = 'none'
const selectedDepositId = ref(NO_DEPOSIT)
const submitting = ref(false)
const toast = useToast()

const linkableDeposits = computed(() =>
  (props.transactions ?? [])
    .filter(t => t.direction === 'deposit' && t.category === null)
    .sort((a, b) => b.date.localeCompare(a.date))
)

watch(open, (isOpen) => {
  if (isOpen) selectedDepositId.value = NO_DEPOSIT
})

async function onLink() {
  if (!props.contribution || selectedDepositId.value === NO_DEPOSIT) {
    toast.add({ title: 'Selecciona el ingreso bancario', color: 'warning' })
    return
  }

  submitting.value = true
  try {
    await $fetch(`/api/bank/contributions/${props.contribution.id}`, {
      method: 'PATCH',
      body: { bankTransactionId: selectedDepositId.value }
    })
    open.value = false
    emit('linked')
    toast.add({ title: 'Aporte vinculado al ingreso', color: 'success' })
  } catch (error) {
    const statusMessage = (error as { data?: { statusMessage?: string } })?.data?.statusMessage
    toast.add({ title: statusMessage ?? 'No se pudo vincular el aporte', color: 'error' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Vincular a ingreso bancario"
    :description="contribution ? `${contribution.memberName} · ${formatEuros(contribution.amountCents)} · ${new Date(contribution.date).toLocaleDateString('es-ES')}` : undefined"
    :ui="{ content: 'max-w-md' }"
  >
    <template #content>
      <form
        class="flex flex-col gap-4 p-6"
        @submit.prevent="onLink"
      >
        <UFormField
          label="Ingreso bancario"
          help="El efectivo entregado pasa a depositado cuando se vincula al ingreso real."
        >
          <USelect
            v-model="selectedDepositId"
            :items="[
              { label: '— Selecciona un ingreso —', value: NO_DEPOSIT },
              ...linkableDeposits.map(t => ({
                label: `${new Date(t.date).toLocaleDateString('es-ES')} · ${formatEuros(t.amountCents)} · ${t.description}`,
                value: t.id
              }))
            ]"
            class="w-full"
          />
        </UFormField>

        <p
          v-if="!linkableDeposits.length"
          class="text-sm text-muted"
        >
          No hay ingresos bancarios sin categoría a los que vincular. Registra primero el
          ingreso en Cuenta bancaria.
        </p>

        <div class="mt-2 flex justify-end gap-2">
          <UButton
            label="Cancelar"
            color="neutral"
            variant="outline"
            type="button"
            @click="open = false"
          />
          <UButton
            type="submit"
            :loading="submitting"
            :disabled="selectedDepositId === NO_DEPOSIT"
          >
            Vincular
          </UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>
