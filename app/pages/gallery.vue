<script setup lang="ts">
import { authClient } from '~/utils/auth-client'

definePageMeta({ middleware: ['auth'] })

interface MediaItem {
  id: string
  type: string
  createdAt: string
}

const session = authClient.useSession()
const { data, refresh } = await useFetch<{ media: MediaItem[] }>('/api/gallery')

const canUpload = computed(() => {
  const role = (session.value.data?.user as { role?: string } | undefined)?.role
  return role === 'admin' || role === 'owner'
})

const file = ref<File | null>(null)
const busy = ref(false)
const errorMessage = ref('')

function onFileChange(event: Event) {
  file.value = (event.target as HTMLInputElement).files?.[0] ?? null
}

async function upload() {
  if (!file.value) return
  errorMessage.value = ''
  busy.value = true
  try {
    const formData = new FormData()
    formData.append('file', file.value)
    await $fetch('/api/gallery', { method: 'POST', body: formData })
    file.value = null
    await refresh()
  } catch {
    errorMessage.value = 'No se pudo subir la foto'
  } finally {
    busy.value = false
  }
}

async function viewPhoto(id: string) {
  const result = await $fetch<{ url: string }>(`/api/gallery/${id}`)
  window.open(result.url, '_blank')
}
</script>

<template>
  <div class="mx-auto flex max-w-3xl flex-col gap-6 py-10">
    <h1 class="text-xl font-semibold">
      Galería
    </h1>

    <UCard v-if="canUpload">
      <template #header>
        <h2 class="text-sm font-semibold">
          Subir foto
        </h2>
      </template>
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="file"
          accept="image/jpeg,image/png"
          class="text-sm"
          @change="onFileChange"
        >
        <UButton
          size="sm"
          :loading="busy"
          :disabled="!file"
          @click="upload"
        >
          Subir
        </UButton>
      </div>
    </UCard>

    <UAlert
      v-if="errorMessage"
      color="error"
      variant="soft"
      :title="errorMessage"
    />

    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <UButton
        v-for="item in data?.media ?? []"
        :key="item.id"
        variant="soft"
        block
        @click="viewPhoto(item.id)"
      >
        {{ new Date(item.createdAt).toLocaleDateString('es-ES') }}
      </UButton>
    </div>
    <p
      v-if="!(data?.media ?? []).length"
      class="text-center text-sm text-muted"
    >
      Sin fotos en la galería todavía
    </p>
  </div>
</template>
