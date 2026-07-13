<script setup lang="ts">
import { authClient } from '~/utils/auth-client'

definePageMeta({ middleware: ['auth'] })

interface MediaItem {
  id: string
  type: string
  createdAt: string
  uploadedBy: string
}

const session = authClient.useSession()
const { data, refresh } = await useFetch<{ media: MediaItem[] }>('/api/gallery')

const currentUserId = computed(() => session.value.data?.user.id)
const currentUserRole = computed(() => (session.value.data?.user as { role?: string } | undefined)?.role)
const canUpload = computed(() => currentUserRole.value === 'admin' || currentUserRole.value === 'owner')

function canDelete(item: MediaItem) {
  return currentUserRole.value === 'admin' || item.uploadedBy === currentUserId.value
}

async function viewPhoto(id: string) {
  const result = await $fetch<{ url: string }>(`/api/gallery/${id}`)
  window.open(result.url, '_blank')
}

async function deletePhoto(id: string) {
  if (!confirm('¿Borrar esta foto? No se puede deshacer.')) return
  await $fetch(`/api/media/${id}`, { method: 'DELETE' })
  await refresh()
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
      <MediaPhotoUpload
        upload-url="/api/gallery"
        @uploaded="refresh"
      />
    </UCard>

    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div
        v-for="item in data?.media ?? []"
        :key="item.id"
        class="flex items-center gap-1"
      >
        <UButton
          variant="soft"
          block
          class="flex-1"
          @click="viewPhoto(item.id)"
        >
          {{ new Date(item.createdAt).toLocaleDateString('es-ES') }}
        </UButton>
        <UButton
          v-if="canDelete(item)"
          icon="i-lucide-trash-2"
          color="error"
          variant="ghost"
          size="sm"
          @click="deletePhoto(item.id)"
        />
      </div>
    </div>
    <p
      v-if="!(data?.media ?? []).length"
      class="text-center text-sm text-muted"
    >
      Sin fotos en la galería todavía
    </p>
  </div>
</template>
