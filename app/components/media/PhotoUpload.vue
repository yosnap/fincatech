<script setup lang="ts">
interface Props {
  // Endpoint que recibe el multipart/form-data (campo `fieldName` + extraFields).
  uploadUrl: string
  // Nombre del campo multipart que espera el endpoint (p.ej. 'file', 'proof', 'attachment').
  fieldName?: string
  extraFields?: Record<string, string>
  accept?: string
  maxSizeMb?: number
  label?: string
  description?: string
}

const props = withDefaults(defineProps<Props>(), {
  fieldName: 'file',
  extraFields: () => ({}),
  accept: 'image/jpeg,image/png',
  maxSizeMb: 10,
  label: 'Arrastra un archivo aquí o haz clic para elegirlo',
  description: 'JPEG o PNG, máx. 10MB'
})

const emit = defineEmits<{ uploaded: [] }>()

const file = ref<File | null>(null)
const busy = ref(false)
const errorMessage = ref('')

function matchesAccept(type: string): boolean {
  return props.accept.split(',').some((pattern) => {
    const trimmed = pattern.trim()
    if (trimmed.endsWith('/*')) return type.startsWith(trimmed.slice(0, -1))
    return trimmed === type
  })
}

function validate(candidate: File): string | null {
  if (!matchesAccept(candidate.type)) {
    return `Tipo de archivo no admitido (esperado: ${props.accept})`
  }
  if (candidate.size > props.maxSizeMb * 1024 * 1024) {
    return `El archivo supera el límite de ${props.maxSizeMb}MB`
  }
  return null
}

watch(file, (candidate) => {
  if (!candidate) return
  const validationError = validate(candidate)
  if (validationError) {
    errorMessage.value = validationError
    file.value = null
  }
})

async function upload() {
  if (!file.value) return
  const validationError = validate(file.value)
  if (validationError) {
    errorMessage.value = validationError
    return
  }

  errorMessage.value = ''
  busy.value = true
  try {
    const formData = new FormData()
    formData.append(props.fieldName, file.value)
    for (const [key, value] of Object.entries(props.extraFields)) {
      formData.append(key, value)
    }
    await $fetch(props.uploadUrl, { method: 'POST', body: formData })
    file.value = null
    emit('uploaded')
  } catch (error) {
    const statusMessage = (error as { data?: { statusMessage?: string } })?.data?.statusMessage
    errorMessage.value = statusMessage ?? 'No se pudo subir el archivo. Inténtalo de nuevo.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <UFileUpload
      v-model="file"
      :accept="accept"
      :label="label"
      :description="description"
      icon="i-lucide-image-plus"
      class="min-h-32 w-full"
    />
    <UAlert
      v-if="errorMessage"
      color="error"
      variant="soft"
      :title="errorMessage"
    />
    <UButton
      size="sm"
      :loading="busy"
      :disabled="!file"
      class="self-start"
      @click="upload"
    >
      Subir
    </UButton>
  </div>
</template>
