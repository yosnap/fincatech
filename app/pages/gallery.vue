<script setup lang="ts">
import { authClient } from '~/utils/auth-client'

definePageMeta({ middleware: ['auth'] })

interface MediaItem {
  id: string
  type: string
  createdAt: string
  uploadedBy: string
  url: string
}

const session = authClient.useSession()
const { data, refresh } = await useFetch<{ media: MediaItem[] }>('/api/gallery')

const currentUserId = computed(() => session.value.data?.user.id)
const currentUserRole = computed(() => (session.value.data?.user as { role?: string } | undefined)?.role)
const canUpload = computed(() => currentUserRole.value === 'admin' || currentUserRole.value === 'owner')

function canDelete(item: MediaItem) {
  return currentUserRole.value === 'admin' || item.uploadedBy === currentUserId.value
}

const galleryPhotos = computed(() => (data.value?.media ?? []).map(item => ({
  id: item.id,
  url: item.url,
  createdAt: item.createdAt,
  canDelete: canDelete(item)
})))

const toast = useToast()

async function deletePhoto(id: string) {
  const confirmed = await useConfirmDialog()({
    title: 'Borrar foto',
    description: 'No se puede deshacer.',
    confirmLabel: 'Borrar',
    color: 'error'
  })
  if (!confirmed) return
  try {
    await $fetch(`/api/media/${id}`, { method: 'DELETE' })
    await refresh()
    toast.add({ title: 'Foto eliminada', color: 'success' })
  } catch {
    toast.add({ title: 'No se pudo borrar la foto', color: 'error' })
  }
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

    <MediaPhotoGallery
      :photos="galleryPhotos"
      empty-label="Sin fotos en la galería todavía"
      @delete="deletePhoto"
    />
    <p
      v-if="(data?.media.length ?? 0) >= 60"
      class="text-center text-xs text-muted"
    >
      Mostrando las 60 fotos más recientes
    </p>
  </div>
</template>
