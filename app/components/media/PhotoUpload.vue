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

async function upload() {
  if (!file.value) return
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
    <FilePicker
      v-model="file"
      :accept="accept"
      :max-size-mb="maxSizeMb"
      :label="label"
      :description="description"
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
