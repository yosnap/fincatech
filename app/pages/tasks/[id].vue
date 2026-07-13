<script setup lang="ts">
import { authClient } from '~/utils/auth-client'

definePageMeta({ middleware: ['auth'] })

interface MediaItem {
  id: string
  type: string
  createdAt: string
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

const canManage = computed(() => {
  const role = (session.value.data?.user as { role?: string } | undefined)?.role
  return role === 'admin' || role === 'owner'
})

const busy = ref(false)
const errorMessage = ref('')
const beforeFile = ref<File | null>(null)
const afterFile = ref<File | null>(null)

function onBeforeFileChange(event: Event) {
  beforeFile.value = (event.target as HTMLInputElement).files?.[0] ?? null
}
function onAfterFileChange(event: Event) {
  afterFile.value = (event.target as HTMLInputElement).files?.[0] ?? null
}

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

async function uploadPhoto(type: 'before' | 'after') {
  const file = type === 'before' ? beforeFile.value : afterFile.value
  if (!file) return
  errorMessage.value = ''
  busy.value = true
  try {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('type', type)
    await $fetch(`/api/tasks/${route.params.id}/media`, { method: 'POST', body: formData })
    if (type === 'before') beforeFile.value = null
    else afterFile.value = null
    await refresh()
  } catch {
    errorMessage.value = 'No se pudo subir la foto'
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
          <UButton
            v-for="photo in beforePhotos()"
            :key="photo.id"
            size="xs"
            variant="soft"
            @click="viewPhoto(photo.id)"
          >
            Ver foto ({{ new Date(photo.createdAt).toLocaleDateString('es-ES') }})
          </UButton>
          <p
            v-if="!beforePhotos().length"
            class="text-sm text-muted"
          >
            Sin fotos
          </p>
          <template v-if="canManage">
            <input
              type="file"
              accept="image/jpeg,image/png"
              class="text-sm"
              @change="onBeforeFileChange"
            >
            <UButton
              size="xs"
              :loading="busy"
              :disabled="!beforeFile"
              @click="uploadPhoto('before')"
            >
              Subir
            </UButton>
          </template>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="text-sm font-semibold">
            Después
          </h2>
        </template>
        <div class="flex flex-col gap-2">
          <UButton
            v-for="photo in afterPhotos()"
            :key="photo.id"
            size="xs"
            variant="soft"
            @click="viewPhoto(photo.id)"
          >
            Ver foto ({{ new Date(photo.createdAt).toLocaleDateString('es-ES') }})
          </UButton>
          <p
            v-if="!afterPhotos().length"
            class="text-sm text-muted"
          >
            Sin fotos
          </p>
          <template v-if="canManage">
            <input
              type="file"
              accept="image/jpeg,image/png"
              class="text-sm"
              @change="onAfterFileChange"
            >
            <UButton
              size="xs"
              :loading="busy"
              :disabled="!afterFile"
              @click="uploadPhoto('after')"
            >
              Subir
            </UButton>
          </template>
        </div>
      </UCard>
    </div>
  </div>
</template>
