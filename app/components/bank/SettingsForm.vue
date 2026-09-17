<script setup lang="ts">
// Configuración financiera global (solo Admin): fecha de compra del inmueble, importe de
// la cuota mensual y mes de inicio de cuotas. Delimita los períodos pre/post compra de
// toda la sección de banco y el grid de contribuciones.

interface Settings {
  purchaseDate: string | null
  quotaAmountCents: number | null
  quotaStartMonth: string | null
}

const props = defineProps<{
  settings: Settings | null
}>()

const emit = defineEmits<{ saved: [] }>()

const open = defineModel<boolean>('open', { default: false })

const purchaseDate = ref('')
const quotaAmount = ref('')
const quotaStartMonth = ref('')
const submitting = ref(false)
const toast = useToast()

// Precargar al abrir con los valores actuales ('' = sin configurar → null).
watch(open, (isOpen) => {
  if (!isOpen) return
  purchaseDate.value = props.settings?.purchaseDate ?? ''
  quotaAmount.value = props.settings?.quotaAmountCents != null
    ? String(props.settings.quotaAmountCents / 100)
    : ''
  quotaStartMonth.value = props.settings?.quotaStartMonth ?? ''
})

async function onSubmit() {
  const quotaAmountCents = quotaAmount.value === '' ? null : Math.round(Number(quotaAmount.value) * 100)
  if (quotaAmountCents !== null && (!Number.isFinite(quotaAmountCents) || quotaAmountCents <= 0)) {
    toast.add({ title: 'Importe de cuota inválido', color: 'warning' })
    return
  }

  submitting.value = true
  try {
    await $fetch('/api/bank/settings', {
      method: 'PUT',
      body: {
        purchaseDate: purchaseDate.value || null,
        quotaAmountCents,
        quotaStartMonth: quotaStartMonth.value || null
      }
    })
    open.value = false
    emit('saved')
    toast.add({ title: 'Configuración guardada', color: 'success' })
  } catch {
    toast.add({ title: 'No se pudo guardar la configuración', color: 'error' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Configuración de finanzas"
    :ui="{ content: 'max-w-md' }"
  >
    <template #content>
      <form
        class="flex flex-col gap-4 p-6"
        @submit.prevent="onSubmit"
      >
        <UFormField
          label="Fecha de compra del inmueble"
          help="Corta el histórico: los movimientos anteriores son del período pre-compra."
        >
          <UInput
            v-model="purchaseDate"
            type="date"
            class="w-full"
          />
        </UFormField>

        <UFormField
          label="Cuota mensual (€)"
          help="Importe fijo que paga cada miembro al mes. Vacío = aún sin definir."
        >
          <UInput
            v-model="quotaAmount"
            type="number"
            step="0.01"
            min="0.01"
            class="w-full"
          />
        </UFormField>

        <UFormField
          label="Mes de inicio de cuotas"
          help="Primer mes con cuota obligatoria (p. ej. 2026-08)."
        >
          <UInput
            v-model="quotaStartMonth"
            type="month"
            class="w-full"
          />
        </UFormField>

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
          >
            Guardar
          </UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>
