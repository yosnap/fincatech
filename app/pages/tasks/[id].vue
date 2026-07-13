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
}

const route = useRoute()
const session = authClient.useSession()
const { data, refresh } = await useFetch<{ task: Task, media: MediaItem[] }>(`/api/tasks/${route.params.id}`)

const STATUS_LABELS: Record<string, string> = { todo: 'Por hacer', in_progress: 'En progreso', done: 'Completado' }

const currentUserId = computed(() => session.value.data?.user.id)
const currentUserRole = computed(() => (session.value.data?.user as { role?: string } | undefined)?.role)
const canManage = computed(() => currentUserRole.value === 'admin' || currentUserRole.value === 'owner')

function canDeletePhoto(item: MediaItem) {
  return currentUserRole.value === 'admin' || item.uploadedBy === currentUserId.value
}

async function deletePhoto(mediaId: string) {
  if (!confirm('¿Borrar esta foto? No se puede deshacer.')) return
  await $fetch(`/api/media/${mediaId}`, { method: 'DELETE' })
  await refresh()
}

const busy = ref(false)
const errorMessage = ref('')

function beforePhotos() {
  return (data.value?.media ?? []).filter(m => m.type === 'before')
}
function afterPhotos() {
  return (data.value?.media ?? []).filter(m => m.type === 'after')
}

async function setStatus(status: string) {
  errorMessage.value = ''
  busy.value = true
  try {
    await $fetch(`/api/tasks/${route.params.id}/status`, { method: 'PATCH', body: { status } })
    await refresh()
  } catch {
    errorMessage.value = 'No se pudo cambiar el estado'
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

      <template
        v-if="canManage"
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
        </div>
      </template>
    </UCard>

    <UAlert
      v-if="errorMessage"
      color="error"
      variant="soft"
      :title="errorMessage"
    />

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
  </div>
</template>
