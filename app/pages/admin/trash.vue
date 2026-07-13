<script setup lang="ts">
definePageMeta({ middleware: ['admin'] })

interface TrashItem {
  id: string
  title: string
  discardedAt: string
}

interface TrashSummary {
  ideas: TrashItem[]
  proposals: TrashItem[]
  tasks: TrashItem[]
}

const { data, refresh } = await useFetch<TrashSummary>('/api/admin/trash')

const busyId = ref<string | null>(null)
const toast = useToast()

const SECTIONS = [
  { key: 'ideas' as const, label: 'Ideas descartadas', deleteUrl: (id: string) => `/api/ideas/${id}` },
  { key: 'proposals' as const, label: 'Propuestas canceladas', deleteUrl: (id: string) => `/api/proposals/${id}` },
  { key: 'tasks' as const, label: 'Tareas descartadas', deleteUrl: (id: string) => `/api/tasks/${id}` }
]

async function deleteForever(deleteUrl: string, id: string) {
  const confirmed = await useConfirmDialog()({
    title: 'Eliminar definitivamente',
    description: 'Esta acción NO se puede deshacer.',
    confirmLabel: 'Eliminar',
    color: 'error'
  })
  if (!confirmed) return
  busyId.value = id
  try {
    await $fetch(deleteUrl, { method: 'DELETE' })
    await refresh()
    toast.add({ title: 'Elemento eliminado definitivamente', color: 'success' })
  } catch {
    toast.add({ title: 'No se pudo eliminar definitivamente', color: 'error' })
  } finally {
    busyId.value = null
  }
}
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-6 py-10">
    <h1 class="text-xl font-semibold">
      Papelera
    </h1>
    <p class="text-sm text-muted">
      Solo Admin. Elementos descartados/cancelados — eliminarlos aquí es definitivo.
    </p>

    <UCard
      v-for="section in SECTIONS"
      :key="section.key"
    >
      <template #header>
        <h2 class="text-lg font-semibold">
          {{ section.label }}
        </h2>
      </template>
      <div class="flex flex-col divide-y divide-default">
        <div
          v-for="item in data?.[section.key] ?? []"
          :key="item.id"
          class="flex items-center justify-between py-2 text-sm"
        >
          <div>
            <p class="font-medium">
              {{ item.title }}
            </p>
            <p class="text-muted">
              Descartado el {{ new Date(item.discardedAt).toLocaleDateString('es-ES') }}
            </p>
          </div>
          <UButton
            size="xs"
            color="error"
            :loading="busyId === item.id"
            @click="deleteForever(section.deleteUrl(item.id), item.id)"
          >
            Eliminar definitivamente
          </UButton>
        </div>
        <p
          v-if="!(data?.[section.key] ?? []).length"
          class="py-4 text-center text-muted"
        >
          Vacío
        </p>
      </div>
    </UCard>
  </div>
</template>
