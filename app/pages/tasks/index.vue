<script setup lang="ts">
import { authClient } from '~/utils/auth-client'

definePageMeta({ middleware: ['auth'] })

interface Task {
  id: string
  title: string
  status: string
  priority: string
  dueDate: string | null
  assigneeId: string | null
}

const session = authClient.useSession()
const { data, refresh } = await useFetch<{ tasks: Task[] }>('/api/tasks')

const STATUS_COLUMNS = [
  { key: 'todo', label: 'Por hacer' },
  { key: 'in_progress', label: 'En progreso' },
  { key: 'done', label: 'Completado' }
]

const PRIORITY_LABELS: Record<string, string> = { low: 'Baja', medium: 'Media', high: 'Alta' }

const canCreate = computed(() => {
  const role = (session.value.data?.user as { role?: string } | undefined)?.role
  return role === 'admin' || role === 'owner'
})

function tasksByStatus(status: string) {
  return (data.value?.tasks ?? []).filter(t => t.status === status)
}

const title = ref('')
const description = ref('')
const submitting = ref(false)
const errorMessage = ref('')

async function onSubmit() {
  errorMessage.value = ''
  submitting.value = true
  try {
    await $fetch('/api/tasks', { method: 'POST', body: { title: title.value, description: description.value } })
    title.value = ''
    description.value = ''
    await refresh()
  } catch {
    errorMessage.value = 'No se pudo crear la tarea'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="mx-auto flex max-w-3xl flex-col gap-6 py-10">
    <h1 class="text-xl font-semibold">
      Tareas
    </h1>

    <UCard v-if="canCreate">
      <template #header>
        <h2 class="text-lg font-semibold">
          Nueva tarea
        </h2>
      </template>
      <form
        class="flex flex-col gap-4"
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
        <UAlert
          v-if="errorMessage"
          color="error"
          variant="soft"
          :title="errorMessage"
        />
        <UButton
          type="submit"
          :loading="submitting"
        >
          Crear tarea
        </UButton>
      </form>
    </UCard>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <UCard
        v-for="column in STATUS_COLUMNS"
        :key="column.key"
      >
        <template #header>
          <h2 class="text-sm font-semibold">
            {{ column.label }} ({{ tasksByStatus(column.key).length }})
          </h2>
        </template>

        <div class="flex flex-col divide-y divide-default">
          <NuxtLink
            v-for="task in tasksByStatus(column.key)"
            :key="task.id"
            :to="`/tasks/${task.id}`"
            class="flex flex-col gap-1 py-2"
          >
            <p class="text-sm font-medium">
              {{ task.title }}
            </p>
            <UBadge
              size="sm"
              variant="soft"
            >
              {{ PRIORITY_LABELS[task.priority] ?? task.priority }}
            </UBadge>
          </NuxtLink>
          <p
            v-if="!tasksByStatus(column.key).length"
            class="py-4 text-center text-sm text-muted"
          >
            Sin tareas
          </p>
        </div>
      </UCard>
    </div>
  </div>
</template>
