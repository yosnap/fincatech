<script setup lang="ts">
// Adjuntar el justificante a un movimiento existente (hasProof false → true), solo Admin.

const props = defineProps<{
  transactionId: string | null
  transactionDescription: string
}>()

const emit = defineEmits<{ attached: [] }>()

const open = defineModel<boolean>('open', { default: false })

const file = ref<File | null>(null)
const submitting = ref(false)
const toast = useToast()

async function onSubmit() {
  if (!props.transactionId || !file.value) {
    toast.add({ title: 'Selecciona el archivo del justificante', color: 'warning' })
    return
  }

  submitting.value = true
  try {
    const formData = new FormData()
    formData.append('proof', file.value)
    await $fetch(`/api/bank/transactions/${props.transactionId}/proof`, { method: 'POST', body: formData })
    file.value = null
    open.value = false
    emit('attached')
    toast.add({ title: 'Justificante adjuntado', color: 'success' })
  } catch {
    toast.add({ title: 'No se pudo adjuntar el justificante', color: 'error' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Adjuntar justificante"
    :description="transactionDescription"
    :ui="{ content: 'max-w-md' }"
  >
    <template #content>
      <form
        class="flex flex-col gap-4 p-6"
        @submit.prevent="onSubmit"
      >
        <FilePicker
          v-model="file"
          accept="image/jpeg,image/png,application/pdf"
          label="Sube la foto o PDF del justificante bancario"
          description="JPEG, PNG o PDF, máx. 10MB"
        />

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
            Adjuntar
          </UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>
