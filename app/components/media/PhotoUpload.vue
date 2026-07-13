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
const toast = useToast()

async function upload() {
  if (!file.value) return
  busy.value = true
  try {
    const formData = new FormData()
    formData.append(props.fieldName, file.value)
    for (const [key, value] of Object.entries(props.extraFields)) {
      formData.append(key, value)
    }
    await $fetch(props.uploadUrl, { method: 'POST', body: formData })
    file.value = null
    toast.add({ title: 'Archivo subido', color: 'success' })
    emit('uploaded')
  } catch (error) {
    const statusMessage = (error as { data?: { statusMessage?: string } })?.data?.statusMessage
    toast.add({ title: statusMessage ?? 'No se pudo subir el archivo. Inténtalo de nuevo.', color: 'error' })
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
