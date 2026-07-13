<script setup lang="ts">
definePageMeta({ middleware: ['auth'] })

const startDate = ref('')
const endDate = ref('')
const errorMessage = ref('')

const canDownload = computed(() => !!startDate.value && !!endDate.value && startDate.value <= endDate.value)

function download(format: 'csv' | 'pdf') {
  errorMessage.value = ''
  if (!canDownload.value) {
    errorMessage.value = 'Selecciona un rango de fechas válido'
    return
  }
  const url = `/api/export/${format}?start=${startDate.value}&end=${endDate.value}`
  window.open(url, '_blank')
}
</script>

<template>
  <div class="mx-auto flex max-w-xl flex-col gap-6 py-10">
    <h1 class="text-xl font-semibold">
      Exportar libro de gastos
    </h1>

    <UAlert
      color="neutral"
      variant="soft"
      title="Documento informativo de uso interno. No es un formato fiscal certificado (no Modelo 347 / AEAT)."
    />

    <UCard>
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-4 sm:flex-row">
          <UFormField
            label="Desde"
            class="flex-1"
          >
            <UInput
              v-model="startDate"
              type="date"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="Hasta"
            class="flex-1"
          >
            <UInput
              v-model="endDate"
              type="date"
              class="w-full"
            />
          </UFormField>
        </div>

        <UAlert
          v-if="errorMessage"
          color="error"
          variant="soft"
          :title="errorMessage"
        />

        <div class="flex gap-2">
          <UButton
            variant="soft"
            @click="download('csv')"
          >
            Descargar CSV
          </UButton>
          <UButton
            @click="download('pdf')"
          >
            Descargar PDF
          </UButton>
        </div>
      </div>
    </UCard>
  </div>
</template>
