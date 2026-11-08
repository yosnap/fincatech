<script setup lang="ts">
// Edición de aporte (solo Admin): tipo, mes de cuota, importe, fecha y notas. El método no
// se edita. Si el aporte es una transferencia individual, el servidor sincroniza su ingreso
// bancario; si el ingreso es compartido o manual, rechaza cambiar el importe con un mensaje.

export interface EditableContribution {
  id: string
  memberName: string
  amountCents: number
  type: string
  period: string | null
  method: string
  date: string
  bankTransactionId: string | null
  notes: string | null
}

const props = defineProps<{ contribution: EditableContribution | null }>()

const emit = defineEmits<{ saved: [] }>()

const open = defineModel<boolean>('open', { default: false })

const TYPE_OPTIONS = [
  { label: 'Cuota mensual', value: 'quota' },
  { label: 'Aporte pre-compra (histórico)', value: 'pre_purchase' },
  { label: 'Aporte extraordinario', value: 'extraordinary' }
]

const type = ref<'quota' | 'pre_purchase' | 'extraordinary'>('quota')
const period = ref('')
const amount = ref('')
const date = ref('')
const notes = ref('')
const saving = ref(false)
const toast = useToast()

watch(open, (isOpen) => {
  const c = props.contribution
  if (!isOpen || !c) return
  type.value = c.type as typeof type.value
  period.value = c.period ?? new Date().toISOString().slice(0, 7)
  amount.value = String(c.amountCents / 100)
  date.value = c.date
  notes.value = c.notes ?? ''
})

async function onSubmit() {
  const c = props.contribution
  if (!c || saving.value) return

  const amountCents = Math.round(Number(amount.value) * 100)
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    toast.add({ title: 'Importe inválido', color: 'warning' })
    return
  }

  saving.value = true
  try {
    await $fetch(`/api/bank/contributions/${c.id}`, {
      method: 'PATCH',
      body: {
        type: type.value,
        period: type.value === 'quota' ? period.value : null,
        amountCents,
        date: date.value,
        notes: notes.value.trim() ? notes.value.trim() : null
      }
    })
    toast.add({ title: 'Aporte actualizado', color: 'success' })
    open.value = false
    emit('saved')
  } catch (error) {
    const statusMessage = (error as { data?: { statusMessage?: string } })?.data?.statusMessage
    toast.add({ title: statusMessage ?? 'No se pudo actualizar el aporte', color: 'error' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="contribution ? `Editar aporte de ${contribution.memberName}` : 'Editar aporte'"
    :ui="{ content: 'max-w-md' }"
  >
    <template #content>
      <form
        class="flex flex-col gap-4 p-6"
        @submit.prevent="onSubmit"
      >
        <UFormField label="Tipo de aporte">
          <USelect
            v-model="type"
            :items="TYPE_OPTIONS"
            class="w-full"
          />
        </UFormField>

        <UFormField
          v-if="type === 'quota'"
          label="Mes de la cuota"
        >
          <UInput
            v-model="period"
            type="month"
            required
            class="w-full"
          />
        </UFormField>

        <UFormField
          label="Importe (€)"
          :help="contribution?.bankTransactionId ? 'Si es una transferencia individual, su ingreso bancario se actualiza igual.' : undefined"
        >
          <UInput
            v-model="amount"
            type="number"
            step="0.01"
            min="0.01"
            required
            class="w-full"
          />
        </UFormField>

        <UFormField label="Fecha del aporte">
          <UInput
            v-model="date"
            type="date"
            required
            class="w-full"
          />
        </UFormField>

        <UFormField label="Notas (opcional)">
          <UInput
            v-model="notes"
            class="w-full"
          />
        </UFormField>

        <p class="text-xs text-muted">
          Método: {{ contribution?.method === 'cash' ? 'efectivo' : 'transferencia' }} (no editable).
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
            :loading="saving"
          >
            Guardar cambios
          </UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>
