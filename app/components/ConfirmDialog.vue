<script lang="ts" setup>
interface ConfirmDialogProps {
  title: string
  description?: string
  confirmLabel?: string
  color?: 'error' | 'primary' | 'neutral'
}

withDefaults(defineProps<ConfirmDialogProps>(), {
  confirmLabel: 'Confirmar',
  color: 'error'
})

const emit = defineEmits<{ close: [boolean] }>()
</script>

<template>
  <UModal
    :title="title"
    :description="description"
    :dismissible="false"
    :ui="{ footer: 'justify-end' }"
  >
    <template #footer>
      <UButton
        label="Cancelar"
        color="neutral"
        variant="outline"
        @click="emit('close', false)"
      />
      <UButton
        :label="confirmLabel"
        :color="color"
        @click="emit('close', true)"
      />
    </template>
  </UModal>
</template>
