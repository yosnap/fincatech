<script setup lang="ts">
interface GalleryPhoto {
  id: string
  url: string
  createdAt: string
  canDelete?: boolean
}

interface Props {
  photos: GalleryPhoto[]
  emptyLabel?: string
}

const props = withDefaults(defineProps<Props>(), {
  emptyLabel: 'Sin fotos todavía'
})

const emit = defineEmits<{ delete: [id: string] }>()

const lightboxOpen = ref(false)
const activeIndex = ref(0)

function openAt(index: number) {
  activeIndex.value = index
  lightboxOpen.value = true
}

function next() {
  activeIndex.value = (activeIndex.value + 1) % props.photos.length
}

function prev() {
  activeIndex.value = (activeIndex.value - 1 + props.photos.length) % props.photos.length
}

const activePhoto = computed(() => props.photos[activeIndex.value])

// Si el array cambia mientras el lightbox está abierto (borrado, refresh del padre), evita
// quedarse apuntando a un índice fuera de rango o a un modal vacío sin foto.
watch(() => props.photos.length, (length) => {
  if (!lightboxOpen.value) return
  if (length === 0) {
    lightboxOpen.value = false
  } else if (activeIndex.value >= length) {
    activeIndex.value = length - 1
  }
})

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('es-ES')
}
</script>

<template>
  <div>
    <div
      v-if="photos.length"
      class="grid grid-cols-3 gap-2 sm:grid-cols-4"
    >
      <div
        v-for="(photo, index) in photos"
        :key="photo.id"
        class="group relative aspect-square overflow-hidden rounded-lg bg-elevated"
      >
        <button
          type="button"
          class="h-full w-full"
          @click="openAt(index)"
        >
          <img
            :src="photo.url"
            :alt="formatDate(photo.createdAt)"
            loading="lazy"
            class="h-full w-full object-cover transition group-hover:scale-105"
          >
        </button>
        <UButton
          v-if="photo.canDelete"
          icon="i-lucide-trash-2"
          color="error"
          variant="solid"
          size="xs"
          class="absolute right-1 top-1 opacity-0 transition group-hover:opacity-100"
          @click.stop="emit('delete', photo.id)"
        />
      </div>
    </div>
    <p
      v-else
      class="py-4 text-center text-sm text-muted"
    >
      {{ emptyLabel }}
    </p>

    <UModal
      v-model:open="lightboxOpen"
      :ui="{ content: 'max-w-3xl' }"
    >
      <template #content>
        <div
          v-if="activePhoto"
          class="relative flex items-center justify-center bg-black"
        >
          <img
            :src="activePhoto.url"
            :alt="formatDate(activePhoto.createdAt)"
            class="max-h-[80vh] w-full object-contain"
          >
          <UButton
            v-if="photos.length > 1"
            icon="i-lucide-chevron-left"
            color="neutral"
            variant="solid"
            class="absolute left-2 top-1/2 -translate-y-1/2"
            @click="prev"
          />
          <UButton
            v-if="photos.length > 1"
            icon="i-lucide-chevron-right"
            color="neutral"
            variant="solid"
            class="absolute right-2 top-1/2 -translate-y-1/2"
            @click="next"
          />
          <p class="absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-black/60 px-2 py-1 text-xs text-white">
            {{ formatDate(activePhoto.createdAt) }} · {{ activeIndex + 1 }}/{{ photos.length }}
          </p>
        </div>
      </template>
    </UModal>
  </div>
</template>
