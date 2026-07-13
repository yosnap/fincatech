<script setup lang="ts">
definePageMeta({ middleware: ['admin'] })

// Catálogo interno de componentes reutilizables — no listado en el nav principal.
// El PhotoUpload sube fotos de verdad al bucket 'gallery' de MinIO: es un catálogo
// funcional, no un mock.
function onUploaded() {
  console.log('Foto subida correctamente (revisa /gallery para verla)')
}

const pickedFile = ref<File | null>(null)
const sampleInput = ref('')
const sampleTextarea = ref('')
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-8 py-10">
    <h1 class="text-xl font-semibold">
      Catálogo de componentes
    </h1>
    <p class="text-sm text-muted">
      Solo visible para Admin. No forma parte de la navegación principal. Todo lo que hay
      aquí es lo que se usa de verdad en el resto de la app — si algo se ve raro en otra
      pantalla y aquí se ve bien, es que esa pantalla no está usando el componente
      compartido y hay que migrarla.
    </p>

    <UCard>
      <template #header>
        <h2 class="text-lg font-semibold">
          FilePicker
        </h2>
      </template>
      <p class="mb-4 text-sm text-muted">
        Selector puro (arrastrar/soltar + botón + vista previa + validación de tipo/tamaño
        en cliente), SIN subida automática — para formularios donde el archivo es un campo
        más entre otros (p.ej. PDF de cotización en propuestas, ticket en el flujo de OCR).
      </p>
      <FilePicker v-model="pickedFile" />
      <p class="mt-2 text-xs text-muted">
        Archivo seleccionado: {{ pickedFile?.name ?? '(ninguno)' }}
      </p>
    </UCard>

    <UCard>
      <template #header>
        <h2 class="text-lg font-semibold">
          PhotoUpload
        </h2>
      </template>
      <p class="mb-4 text-sm text-muted">
        `FilePicker` + botón "Subir" que hace la petición HTTP por su cuenta. Para el caso
        más común: subir una foto y ya está (tareas, galería, ideas, propuestas,
        comprobante de pago).
      </p>
      <MediaPhotoUpload
        upload-url="/api/gallery"
        @uploaded="onUploaded"
      />
    </UCard>

    <UCard>
      <template #header>
        <h2 class="text-lg font-semibold">
          Botones
        </h2>
      </template>
      <div class="flex flex-wrap items-center gap-2">
        <UButton>Acción principal</UButton>
        <UButton
          variant="soft"
          color="neutral"
        >
          Secundaria
        </UButton>
        <UButton
          variant="ghost"
          color="neutral"
        >
          Terciaria/ghost
        </UButton>
        <UButton color="success">
          Confirmar (success)
        </UButton>
        <UButton
          color="error"
          variant="soft"
        >
          Destructiva suave
        </UButton>
        <UButton color="error">
          Destructiva
        </UButton>
        <UButton loading>
          Cargando
        </UButton>
        <UButton disabled>
          Deshabilitado
        </UButton>
        <UButton
          icon="i-lucide-arrow-left"
          variant="ghost"
          color="neutral"
        >
          Volver
        </UButton>
        <UButton
          icon="i-lucide-trash-2"
          color="error"
          variant="ghost"
        />
      </div>
    </UCard>

    <UCard>
      <template #header>
        <h2 class="text-lg font-semibold">
          Formularios
        </h2>
      </template>
      <form class="flex flex-col gap-4">
        <UFormField label="Campo de texto">
          <UInput
            v-model="sampleInput"
            placeholder="Texto de ejemplo"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Área de texto">
          <UTextarea
            v-model="sampleTextarea"
            placeholder="Descripción..."
            class="w-full"
          />
        </UFormField>
        <UFormField label="Checkbox">
          <UCheckbox label="Opción marcable" />
        </UFormField>
      </form>
    </UCard>

    <UCard>
      <template #header>
        <h2 class="text-lg font-semibold">
          Estados y mensajes
        </h2>
      </template>
      <div class="flex flex-col gap-3">
        <UBadge variant="soft">
          Badge neutro
        </UBadge>
        <UBadge
          color="success"
          variant="soft"
        >
          Badge éxito
        </UBadge>
        <UBadge
          color="error"
          variant="soft"
        >
          Badge error
        </UBadge>
        <UAlert
          color="error"
          variant="soft"
          title="Alerta de error"
          description="Así se ven los mensajes de error en formularios y acciones."
        />
        <UAlert
          color="warning"
          variant="soft"
          title="Alerta de aviso"
        />
        <UAlert
          color="neutral"
          variant="soft"
          title="Alerta informativa"
        />
      </div>
    </UCard>
  </div>
</template>
