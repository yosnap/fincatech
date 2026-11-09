<script setup lang="ts">
// Edición de una tarea (Admin y Propietario): título, descripción, prioridad y fecha límite.
// La reasignación y el estado tienen sus propios controles en la página de detalle.

export interface EditableTask {
  id: string
  title: string
  description: string | null
  priority: string
  dueDate: string | null
}

const props = defineProps<{ task: EditableTask | null }>()

const emit = defineEmits<{ saved: [] }>()

const open = defineModel<boolean>('open', { default: false })

const PRIORITY_OPTIONS = [
  { label: 'Baja', value: 'low' },
  { label: 'Media', value: 'medium' },
  { label: 'Alta', value: 'high' }
]

const title = ref('')
const description = ref('')
const priority = ref('medium')
const dueDate = ref('')
const saving = ref(false)
const toast = useToast()

watch(open, (isOpen) => {
  const t = props.task
  if (!isOpen || !t) return
  title.value = t.title
  description.value = t.description ?? ''
  priority.value = t.priority
  // La API devuelve el timestamp ISO (medianoche UTC del día elegido); el input usa 'YYYY-MM-DD'.
  dueDate.value = t.dueDate ? t.dueDate.slice(0, 10) : ''
})

async function onSubmit() {
  const t = props.task
  if (!t || saving.value) return
  if (!title.value.trim()) {
    toast.add({ title: 'El título no puede estar vacío', color: 'warning' })
    return
  }

  saving.value = true
  try {
    await $fetch(`/api/tasks/${t.id}`, {
      method: 'PATCH',
      body: {
        title: title.value.trim(),
        description: description.value.trim() ? description.value.trim() : null,
        priority: priority.value,
        dueDate: dueDate.value || null
      }
    })
    toast.add({ title: 'Tarea actualizada', color: 'success' })
    open.value = false
    emit('saved')
  } catch (error) {
    const statusMessage = (error as { data?: { statusMessage?: string } })?.data?.statusMessage
    toast.add({ title: statusMessage ?? 'No se pudo actualizar la tarea', color: 'error' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Editar tarea"
    :ui="{ content: 'max-w-md' }"
  >
    <template #content>
      <form
        class="flex flex-col gap-4 p-6"
        @submit.prevent="onSubmit"
      >
        <UFormField label="Título">
          <UInput
            v-model="title"
            required
            class="w-full"
          />
        </UFormField>

        <UFormField label="Descripción (opcional)">
          <UTextarea
            v-model="description"
            class="w-full"
          />
        </UFormField>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <UFormField label="Prioridad">
            <USelect
              v-model="priority"
              :items="PRIORITY_OPTIONS"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Fecha límite (opcional)">
            <UInput
              v-model="dueDate"
              type="date"
              class="w-full"
            />
          </UFormField>
        </div>

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
