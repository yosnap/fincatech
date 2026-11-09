<script setup lang="ts">
// Ajustes del asistente IA del bot de Telegram (solo Admin): proveedor, clave (se guarda
// cifrada y nunca se vuelve a mostrar), modelo y una prueba de function calling.
definePageMeta({ middleware: ['admin'] })

interface SettingsView {
  enabled: boolean
  baseUrl: string
  model: string | null
  keySource: 'db' | 'env' | null
  keyHint: string | null
  keyUnreadable: boolean
  envBaseUrl: string
  envModel: string | null
  envKeyAvailable: boolean
  configured: boolean
  updatedAt: string | null
}

interface ToolTestResult {
  label: string
  ok: boolean
  tool: string | null
  arguments: string | null
  ms: number
  error: string | null
}

// Atajos conocidos; «Otro» admite cualquier API compatible con OpenAI (`/models` y
// `/chat/completions` con function calling) escribiendo su URL base.
const CUSTOM_PROVIDER = 'custom'
const PROVIDERS = [
  { label: 'Nan Builders', value: 'https://api.nan.builders/v1' },
  { label: 'OpenRouter', value: 'https://openrouter.ai/api/v1' },
  { label: 'OpenAI', value: 'https://api.openai.com/v1' },
  { label: 'Otro compatible con OpenAI', value: CUSTOM_PROVIDER }
]

const { data } = await useFetch<SettingsView>('/api/admin/ai-agent')
const toast = useToast()

const enabled = ref(true)
const baseUrl = ref('')
const model = ref<string | undefined>()
const apiKey = ref('')
const models = ref<string[]>([])
const testResults = ref<ToolTestResult[] | null>(null)
const loadingModels = ref(false)
const testing = ref(false)
const saving = ref(false)

watch(data, (value) => {
  if (!value) return
  enabled.value = value.enabled
  baseUrl.value = value.baseUrl
  customProvider.value = false
  model.value = value.model ?? undefined
  apiKey.value = ''
}, { immediate: true })

const normalizedBaseUrl = computed(() => baseUrl.value.trim().replace(/\/+$/, ''))
const customProvider = ref(false)
const provider = computed({
  get: () => customProvider.value
    ? CUSTOM_PROVIDER
    : (PROVIDERS.find(item => item.value === normalizedBaseUrl.value)?.value ?? CUSTOM_PROVIDER),
  set: (value: string) => {
    customProvider.value = value === CUSTOM_PROVIDER
    baseUrl.value = customProvider.value ? '' : value
  }
})
const providerChanged = computed(() => !!data.value && normalizedBaseUrl.value !== data.value.baseUrl)
const modelItems = computed(() => {
  const items = [...models.value]
  if (model.value && !items.includes(model.value)) items.unshift(model.value)
  return items
})

const keyStatus = computed(() => {
  const view = data.value
  if (!view) return ''
  if (apiKey.value) return 'Se guardará la clave nueva.'
  if (providerChanged.value) {
    return normalizedBaseUrl.value === view.envBaseUrl && view.envKeyAvailable
      ? 'Se usará la clave de las variables de entorno del servidor.'
      : 'Has cambiado de proveedor: introduce su clave.'
  }
  if (view.keyUnreadable) return 'La clave guardada no se puede leer (cambió el secreto del servidor). Vuelve a introducirla.'
  if (view.keySource === 'db') return `Clave guardada (termina en ${view.keyHint ?? '····'}).`
  if (view.keySource === 'env') return 'Se usa la clave de las variables de entorno del servidor.'
  return 'No hay clave para este proveedor.'
})

// Lo que se envía para listar modelos o probar sin guardar.
function connectionBody() {
  return {
    baseUrl: baseUrl.value.trim(),
    ...(apiKey.value.trim() ? { apiKey: apiKey.value.trim() } : {})
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return (error as { data?: { statusMessage?: string } })?.data?.statusMessage ?? fallback
}

function onCreateModel(value: string) {
  model.value = value.trim()
}

async function loadModels() {
  loadingModels.value = true
  try {
    const result = await $fetch<{ models: string[] }>('/api/admin/ai-agent/models', { method: 'POST', body: connectionBody() })
    models.value = result.models
    toast.add({ title: `${result.models.length} modelos disponibles`, color: 'success' })
  } catch (error) {
    toast.add({ title: 'No se pudieron cargar los modelos', description: errorMessage(error, 'Revisa la URL y la clave'), color: 'error' })
  } finally {
    loadingModels.value = false
  }
}

async function runTest() {
  if (!model.value) return
  testing.value = true
  testResults.value = null
  try {
    const result = await $fetch<{ results: ToolTestResult[] }>('/api/admin/ai-agent/test', {
      method: 'POST',
      body: { ...connectionBody(), model: model.value }
    })
    testResults.value = result.results
  } catch (error) {
    toast.add({ title: 'No se pudo hacer la prueba', description: errorMessage(error, 'Revisa la URL y la clave'), color: 'error' })
  } finally {
    testing.value = false
  }
}

async function save() {
  saving.value = true
  try {
    data.value = await $fetch<SettingsView>('/api/admin/ai-agent', {
      method: 'PUT',
      body: {
        enabled: enabled.value,
        baseUrl: baseUrl.value.trim(),
        model: model.value?.trim() || null,
        ...(apiKey.value.trim() ? { apiKey: apiKey.value.trim() } : {})
      }
    })
    toast.add({ title: 'Ajustes guardados', color: 'success' })
  } catch (error) {
    toast.add({ title: 'No se pudieron guardar', description: errorMessage(error, 'Revisa los datos'), color: 'error' })
  }
  saving.value = false
}

// Borra solo la clave guardada; conserva lo que haya en el formulario sin guardar.
async function clearStoredKey() {
  const confirmed = await useConfirmDialog()({
    title: 'Borrar la clave guardada',
    description: 'El asistente usará la clave de las variables de entorno si es del mismo proveedor; si no, dejará de funcionar hasta que guardes otra.',
    confirmLabel: 'Borrar'
  })
  if (!confirmed || !data.value) return
  const form = { enabled: enabled.value, baseUrl: baseUrl.value, model: model.value }
  try {
    data.value = await $fetch<SettingsView>('/api/admin/ai-agent', {
      method: 'PUT',
      body: { enabled: data.value.enabled, baseUrl: data.value.baseUrl, model: data.value.model, clearApiKey: true }
    })
    // El watch de `data` rellena el formulario; se restaura lo que había después.
    await nextTick()
    enabled.value = form.enabled
    baseUrl.value = form.baseUrl
    model.value = form.model
    toast.add({ title: 'Clave borrada', color: 'success' })
  } catch (error) {
    toast.add({ title: 'No se pudo borrar la clave', description: errorMessage(error, ''), color: 'error' })
  }
}

async function resetToEnv() {
  const confirmed = await useConfirmDialog()({
    title: 'Restablecer los valores del servidor',
    description: 'Se borran los ajustes guardados aquí, incluida la clave, y el asistente vuelve a usar las variables de entorno.',
    confirmLabel: 'Restablecer'
  })
  if (!confirmed) return
  try {
    data.value = await $fetch<SettingsView>('/api/admin/ai-agent', { method: 'DELETE' })
    models.value = []
    testResults.value = null
    toast.add({ title: 'Ajustes restablecidos', color: 'success' })
  } catch (error) {
    toast.add({ title: 'No se pudieron restablecer', description: errorMessage(error, ''), color: 'error' })
  }
}
</script>

<template>
  <div class="mx-auto flex max-w-xl flex-col gap-6 py-10">
    <UCard v-if="data">
      <template #header>
        <div class="flex items-center justify-between gap-3">
          <h1 class="text-lg font-semibold">
            Asistente IA
          </h1>
          <UBadge
            :color="data.configured ? 'success' : 'neutral'"
            variant="soft"
          >
            {{ data.configured ? 'Activo' : 'Inactivo' }}
          </UBadge>
        </div>
        <p class="mt-1 text-sm text-muted">
          El asistente responde a los administradores en el bot de Telegram. Necesita un proveedor compatible con OpenAI y un modelo que sepa usar herramientas.
        </p>
      </template>

      <form
        class="flex flex-col gap-5"
        @submit.prevent="save"
      >
        <USwitch
          v-model="enabled"
          label="Asistente activado"
          description="Si lo desactivas, el bot solo procesa fotos de tickets."
        />

        <UFormField
          label="Proveedor"
          description="Cualquier API compatible con OpenAI que admita herramientas (function calling)."
        >
          <div class="flex flex-col gap-2">
            <USelect
              v-model="provider"
              :items="PROVIDERS"
              class="w-full"
            />
            <UInput
              v-if="provider === CUSTOM_PROVIDER"
              v-model="baseUrl"
              class="w-full"
              placeholder="https://api.ejemplo.com/v1"
            />
            <p class="text-xs text-muted">
              URL base: {{ normalizedBaseUrl || 'sin definir' }}. Suele terminar en /v1; debe empezar por https://.
            </p>
          </div>
        </UFormField>

        <UFormField
          label="Clave del proveedor"
          :description="keyStatus"
        >
          <div class="flex gap-2">
            <UInput
              v-model="apiKey"
              type="password"
              autocomplete="off"
              class="w-full"
              placeholder="Pega una clave nueva para sustituirla"
            />
            <UButton
              v-if="(data.keySource === 'db' || data.keyUnreadable) && !providerChanged"
              color="error"
              variant="soft"
              @click="clearStoredKey"
            >
              Borrar
            </UButton>
          </div>
        </UFormField>

        <UFormField
          label="Modelo"
          description="Carga la lista del proveedor o escribe el nombre exacto."
        >
          <div class="flex gap-2">
            <USelectMenu
              v-model="model"
              :items="modelItems"
              create-item
              class="w-full"
              placeholder="Elige un modelo"
              @create="onCreateModel"
            />
            <UButton
              color="neutral"
              variant="soft"
              :loading="loadingModels"
              @click="loadModels"
            >
              Cargar modelos
            </UButton>
          </div>
        </UFormField>

        <div class="flex flex-col gap-3 rounded-lg border border-default p-3">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="text-sm font-medium">
                Probar el modelo
              </p>
              <p class="text-xs text-muted">
                Le pide una consulta y un cambio y comprueba que elige bien la herramienta. No ejecuta nada.
              </p>
            </div>
            <UButton
              color="neutral"
              variant="soft"
              :loading="testing"
              :disabled="!model"
              @click="runTest"
            >
              Probar
            </UButton>
          </div>
          <ul
            v-if="testResults"
            class="flex flex-col gap-2 text-sm"
          >
            <li
              v-for="result in testResults"
              :key="result.label"
              class="flex items-start gap-2"
            >
              <UIcon
                :name="result.ok ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
                :class="result.ok ? 'text-success' : 'text-error'"
                class="mt-0.5 size-4 shrink-0"
              />
              <div class="min-w-0">
                <p>
                  {{ result.label }}: {{ result.ok ? 'correcto' : result.error }}
                  <span class="text-muted">({{ (result.ms / 1000).toFixed(1) }} s)</span>
                </p>
                <p
                  v-if="result.tool"
                  class="break-all text-xs text-muted"
                >
                  {{ result.tool }}({{ result.arguments }})
                </p>
              </div>
            </li>
          </ul>
        </div>

        <div class="flex justify-between gap-3">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="!data.updatedAt"
            @click="resetToEnv"
          >
            Restablecer valores del servidor
          </UButton>
          <UButton
            type="submit"
            :loading="saving"
          >
            Guardar
          </UButton>
        </div>
      </form>
    </UCard>
  </div>
</template>
