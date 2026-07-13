<script setup lang="ts">
interface Props {
  accept?: string
  maxSizeMb?: number
  label?: string
  description?: string
}

const props = withDefaults(defineProps<Props>(), {
  accept: 'image/jpeg,image/png',
  maxSizeMb: 10,
  label: 'Arrastra un archivo aquí o haz clic para elegirlo',
  description: 'JPEG o PNG, máx. 10MB'
})

const file = defineModel<File | null>({ default: null })
const toast = useToast()

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
    toast.add({ title: validationError, color: 'warning' })
    file.value = null
  }
})
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
  </div>
</template>
