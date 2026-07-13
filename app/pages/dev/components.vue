<script setup lang="ts">
definePageMeta({ middleware: ['admin'] })

// Catálogo interno de componentes reutilizables — no listado en el nav principal.
// Sube fotos de verdad al bucket 'gallery' de MinIO: es un catálogo funcional, no un mock.
function onUploaded() {
  console.log('Foto subida correctamente (revisa /gallery para verla)')
}
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-8 py-10">
    <h1 class="text-xl font-semibold">
      Catálogo de componentes
    </h1>
    <p class="text-sm text-muted">
      Solo visible para Admin. No forma parte de la navegación principal.
    </p>

    <UCard>
      <template #header>
        <h2 class="text-lg font-semibold">
          PhotoUpload
        </h2>
      </template>
      <p class="mb-4 text-sm text-muted">
        Subida de fotos con zona de arrastrar/soltar, botón visible y vista previa. Usado en
        tareas, galería, ideas y propuestas.
      </p>
      <MediaPhotoUpload
        upload-url="/api/gallery"
        @uploaded="onUploaded"
      />
    </UCard>
  </div>
</template>
