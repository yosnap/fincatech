<script setup lang="ts">
// Alta/edición de movimiento bancario (modal, solo Admin = tesorero). El justificante es
// opcional y puede adjuntarse después desde la lista (en edición no se toca aquí). Los
// ingresos externos (Hacienda, IVA…) llevan categoría y NO se acreditan a ningún miembro
// en el fondo común.

// OJO: la opción "sin categoría" usa el centinela 'none', NO una cadena vacía — un item de
// USelect con value '' impide que UModal se desmonte al cerrar (bug de reka-ui/Nuxt UI
// verificado empíricamente: el DOM del diálogo queda pegado con data-state=open).
const NO_CATEGORY = 'none'

interface EditableTransaction {
  id: string
  date: string
  direction: 'deposit' | 'withdrawal'
  amountCents: number
  description: string
  category: string | null
}

// Con `transaction` el formulario edita ese movimiento (PATCH); sin él, crea uno nuevo.
const props = defineProps<{ transaction?: EditableTransaction | null }>()

const emit = defineEmits<{ saved: [] }>()

const open = defineModel<boolean>('open', { default: false })

const DIRECTION_OPTIONS = [
  { label: 'Ingreso', value: 'deposit' },
  { label: 'Salida', value: 'withdrawal' }
]

const CATEGORY_OPTIONS = [
  { label: 'Hacienda (devolución)', value: 'hacienda' },
  { label: 'Ayuntamiento (devolución)', value: 'ayuntamiento' },
  { label: 'Impuestos (devolución)', value: 'impuestos' },
  { label: 'Compensación IVA', value: 'iva' },
  { label: 'Otro', value: 'otro' }
]

// Precargar al abrir según el modo (alta o edición).
watch(open, (isOpen) => {
  if (isOpen) resetForm()
})

const date = ref(new Date().toISOString().slice(0, 10))
const direction = ref<'deposit' | 'withdrawal'>('deposit')
const amount = ref('')
const description = ref('')
const category = ref<string>(NO_CATEGORY)
const proofFile = ref<File | null>(null)
const submitting = ref(false)
const toast = useToast()

const editing = computed(() => !!props.transaction)

function resetForm() {
  if (props.transaction) {
    date.value = props.transaction.date
    direction.value = props.transaction.direction
    amount.value = String(props.transaction.amountCents / 100)
    description.value = props.transaction.description
    category.value = props.transaction.category ?? NO_CATEGORY
  } else {
    date.value = new Date().toISOString().slice(0, 10)
    direction.value = 'deposit'
    amount.value = ''
    description.value = ''
    category.value = NO_CATEGORY
  }
  proofFile.value = null
}

async function onSubmit() {
  const amountCents = Math.round(Number(amount.value) * 100)
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    toast.add({ title: 'Importe inválido', color: 'warning' })
    return
  }
  if (!description.value.trim()) {
    toast.add({ title: 'La descripción es obligatoria', color: 'warning' })
    return
  }

  submitting.value = true
  try {
    if (editing.value && props.transaction) {
      await $fetch(`/api/bank/transactions/${props.transaction.id}`, {
        method: 'PATCH',
        body: {
          date: date.value,
          direction: direction.value,
          amountCents,
          description: description.value,
          category: direction.value === 'deposit' && category.value !== NO_CATEGORY ? category.value : null
        }
      })
      open.value = false
      emit('saved')
      toast.add({ title: 'Movimiento actualizado', color: 'success' })
    } else {
      const formData = new FormData()
      formData.append('date', date.value)
      formData.append('direction', direction.value)
      formData.append('amountCents', String(amountCents))
      formData.append('description', description.value)
      if (direction.value === 'deposit' && category.value !== NO_CATEGORY) formData.append('category', category.value)
      if (proofFile.value) formData.append('proof', proofFile.value)

      await $fetch('/api/bank/transactions', { method: 'POST', body: formData })
      resetForm()
      open.value = false
      emit('saved')
      toast.add({ title: 'Movimiento creado', color: 'success' })
    }
  } catch (error) {
    const statusMessage = (error as { data?: { statusMessage?: string } })?.data?.statusMessage
    toast.add({ title: statusMessage ?? 'No se pudo guardar el movimiento', color: 'error' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="editing ? 'Editar movimiento' : 'Nuevo movimiento bancario'"
    :ui="{ content: 'max-w-md' }"
  >
    <template #body>
      <form
        id="transaction-form"
        class="flex flex-col gap-4"
        @submit.prevent="onSubmit"
      >
        <UFormField label="Fecha">
          <UInput
            v-model="date"
            type="date"
            required
            class="w-full"
          />
        </UFormField>

        <UFormField label="Dirección">
          <USelect
            v-model="direction"
            :items="DIRECTION_OPTIONS"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Importe (€)">
          <UInput
            v-model="amount"
            type="number"
            step="0.01"
            min="0.01"
            required
            class="w-full"
          />
        </UFormField>

        <UFormField label="Descripción">
          <UInput
            v-model="description"
            required
            class="w-full"
          />
        </UFormField>

        <UFormField
          v-if="direction === 'deposit'"
          label="Categoría (solo ingresos externos)"
          help="Déjalo vacío si el ingreso viene de un miembro o ya está explicado."
        >
          <USelect
            v-model="category"
            :items="[{ label: '— Sin categoría —', value: NO_CATEGORY }, ...CATEGORY_OPTIONS]"
            class="w-full"
          />
        </UFormField>

        <FilePicker
          v-if="!editing"
          v-model="proofFile"
          accept="image/jpeg,image/png,application/pdf"
          label="Justificante (opcional, puedes adjuntarlo después)"
          description="JPEG, PNG o PDF, máx. 10MB"
        />
        <p
          v-else
          class="text-xs text-muted"
        >
          El justificante se adjunta o se quita desde la lista, no en la edición.
        </p>
      </form>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="Cancelar"
          color="neutral"
          variant="outline"
          @click="open = false"
        />
        <UButton
          type="submit"
          form="transaction-form"
          :loading="submitting"
        >
          {{ editing ? 'Guardar cambios' : 'Crear movimiento' }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
