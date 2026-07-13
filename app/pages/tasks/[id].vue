<script setup lang="ts">
import { authClient } from '~/utils/auth-client'

definePageMeta({ middleware: ['auth'] })

interface MediaItem {
  id: string
  type: string
  createdAt: string
  uploadedBy: string
}

interface Task {
  id: string
  title: string
  description: string | null
  status: string
  priority: string
  createdBy: string
  assigneeId: string | null
  discardedAt: string | null
}

interface Member {
  id: string
  name: string
  role: string
}

const route = useRoute()
const session = authClient.useSession()
const { data, refresh } = await useFetch<{ task: Task, media: MediaItem[] }>(`/api/tasks/${route.params.id}`)
const { data: membersData } = await useFetch<{ members: Member[] }>('/api/expenses/participants')

const assigneeOptions = computed(() => (membersData.value?.members ?? []).map(m => ({ label: m.name, value: m.id })))
const assigneeName = computed(() => {
  const id = data.value?.task.assigneeId
  if (!id) return null
  return (membersData.value?.members ?? []).find(m => m.id === id)?.name ?? id
})

const toast = useToast()

async function reassign(newAssigneeId: string) {
  busy.value = true
  try {
    await $fetch(`/api/tasks/${route.params.id}`, { method: 'PATCH', body: { assigneeId: newAssigneeId } })
    await refresh()
    toast.add({ title: 'Tarea reasignada', color: 'success' })
  } catch {
    toast.add({ title: 'No se pudo reasignar la tarea', color: 'error' })
  } finally {
    busy.value = false
  }
}

const STATUS_LABELS: Record<string, string> = { todo: 'Por hacer', in_progress: 'En progreso', done: 'Completado' }

const currentUserId = computed(() => session.value.data?.user.id)
const currentUserRole = computed(() => (session.value.data?.user as { role?: string } | undefined)?.role)
const canManage = computed(() => currentUserRole.value === 'admin' || currentUserRole.value === 'owner')
const canDiscard = computed(() => currentUserRole.value === 'admin' || data.value?.task.createdBy === currentUserId.value)

async function discardTask() {
  const confirmed = await useConfirmDialog()({
    title: 'Descartar tarea',
    description: 'Se ocultará del listado.',
    confirmLabel: 'Descartar',
    color: 'error'
  })
  if (!confirmed) return
  busy.value = true
  try {
    await $fetch(`/api/tasks/${route.params.id}/discard`, { method: 'POST' })
    toast.add({ title: 'Tarea descartada', color: 'success' })
    await navigateTo('/tasks')
  } catch {
    toast.add({ title: 'No se pudo descartar la tarea', color: 'error' })
    busy.value = false
  }
}

function canDeletePhoto(item: MediaItem) {
  return currentUserRole.value === 'admin' || item.uploadedBy === currentUserId.value
}

async function deletePhoto(mediaId: string) {
  const confirmed = await useConfirmDialog()({
    title: 'Borrar foto',
    description: 'No se puede deshacer.',
    confirmLabel: 'Borrar',
    color: 'error'
  })
  if (!confirmed) return
  try {
    await $fetch(`/api/media/${mediaId}`, { method: 'DELETE' })
    await refresh()
    toast.add({ title: 'Foto eliminada', color: 'success' })
  } catch {
    toast.add({ title: 'No se pudo borrar la foto', color: 'error' })
  }
}

const busy = ref(false)

function beforePhotos() {
  return (data.value?.media ?? []).filter(m => m.type === 'before')
}
function afterPhotos() {
  return (data.value?.media ?? []).filter(m => m.type === 'after')
}

async function setStatus(status: string) {
  busy.value = true
  try {
    await $fetch(`/api/tasks/${route.params.id}/status`, { method: 'PATCH', body: { status } })
    await refresh()
    toast.add({ title: 'Estado actualizado', color: 'success' })
  } catch {
    toast.add({ title: 'No se pudo cambiar el estado', color: 'error' })
  } finally {
    busy.value = false
  }
}

async function viewPhoto(mediaId: string) {
  const result = await $fetch<{ url: string }>(`/api/tasks/${route.params.id}/media/${mediaId}`)
  window.open(result.url, '_blank')
}
</script>

<template>
  <div
    v-if="data"
    class="mx-auto flex max-w-2xl flex-col gap-6 py-10"
  >
    <UButton
      icon="i-lucide-arrow-left"
      variant="ghost"
      color="neutral"
      size="sm"
      class="self-start"
      to="/tasks"
    >
      Volver
    </UButton>

    <UCard>
      <template #header>
        <div class="flex items-center justify-between">
          <h1 class="text-lg font-semibold">
            {{ data.task.title }}
          </h1>
          <UBadge variant="soft">
            {{ STATUS_LABELS[data.task.status] ?? data.task.status }}
          </UBadge>
        </div>
      </template>
      <p
        v-if="data.task.description"
        class="whitespace-pre-wrap text-sm"
      >
        {{ data.task.description }}
      </p>

      <div class="mt-3 flex items-center gap-2 text-sm">
        <span class="text-muted">Asignado a:</span>
        <USelect
          v-if="canManage && !data.task.discardedAt"
          :model-value="data.task.assigneeId ?? undefined"
          :items="assigneeOptions"
          placeholder="Sin asignar"
          class="w-48"
          @update:model-value="(value) => reassign(value as string)"
        />
        <span v-else>{{ assigneeName ?? 'Sin asignar' }}</span>
      </div>

      <UAlert
        v-if="data.task.discardedAt"
        color="warning"
        variant="soft"
        title="Esta tarea está descartada"
        description="No admite cambios de estado. Solo Admin puede eliminarla definitivamente desde la papelera."
      />

      <template
        v-if="canManage && !data.task.discardedAt"
        #footer
      >
        <div class="flex flex-wrap gap-2">
          <UButton
            v-if="data.task.status !== 'todo'"
            size="sm"
            variant="soft"
            :loading="busy"
            @click="setStatus('todo')"
          >
            Por hacer
          </UButton>
          <UButton
            v-if="data.task.status !== 'in_progress'"
            size="sm"
            variant="soft"
            :loading="busy"
            @click="setStatus('in_progress')"
          >
            En progreso
          </UButton>
          <UButton
            v-if="data.task.status !== 'done'"
            size="sm"
            color="success"
            :loading="busy"
            @click="setStatus('done')"
          >
            Completado
          </UButton>
          <UButton
            v-if="canDiscard"
            size="sm"
            color="error"
            variant="soft"
            :loading="busy"
            @click="discardTask"
          >
            Descartar
          </UButton>
        </div>
      </template>
    </UCard>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <UCard>
        <template #header>
          <h2 class="text-sm font-semibold">
            Antes
          </h2>
        </template>
        <div class="flex flex-col gap-2">
          <div
            v-for="photo in beforePhotos()"
            :key="photo.id"
            class="flex items-center gap-1"
          >
            <UButton
              size="xs"
              variant="soft"
              class="flex-1"
              @click="viewPhoto(photo.id)"
            >
              Ver foto ({{ new Date(photo.createdAt).toLocaleDateString('es-ES') }})
            </UButton>
            <UButton
              v-if="canDeletePhoto(photo)"
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              size="xs"
              @click="deletePhoto(photo.id)"
            />
          </div>
          <p
            v-if="!beforePhotos().length"
            class="text-sm text-muted"
          >
            Sin fotos
          </p>
          <MediaPhotoUpload
            v-if="canManage"
            :upload-url="`/api/tasks/${route.params.id}/media`"
            :extra-fields="{ type: 'before' }"
            label="Foto de antes"
            @uploaded="refresh"
          />
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="text-sm font-semibold">
            Después
          </h2>
        </template>
        <div class="flex flex-col gap-2">
          <div
            v-for="photo in afterPhotos()"
            :key="photo.id"
            class="flex items-center gap-1"
          >
            <UButton
              size="xs"
              variant="soft"
              class="flex-1"
              @click="viewPhoto(photo.id)"
            >
              Ver foto ({{ new Date(photo.createdAt).toLocaleDateString('es-ES') }})
            </UButton>
            <UButton
              v-if="canDeletePhoto(photo)"
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              size="xs"
              @click="deletePhoto(photo.id)"
            />
          </div>
          <p
            v-if="!afterPhotos().length"
            class="text-sm text-muted"
          >
            Sin fotos
          </p>
          <MediaPhotoUpload
            v-if="canManage"
            :upload-url="`/api/tasks/${route.params.id}/media`"
            :extra-fields="{ type: 'after' }"
            label="Foto de después"
            @uploaded="refresh"
          />
        </div>
      </UCard>
    </div>

    <ReferenceLinksCard :base-url="`/api/tasks/${route.params.id}`" />
  </div>
</template>
