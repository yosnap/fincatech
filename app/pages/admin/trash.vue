<script setup lang="ts">
definePageMeta({ middleware: ['admin'] })

interface TrashItem {
  id: string
  title: string
  amountCents?: number
  date?: string
  type?: string
  direction?: string
  discardedAt: string
}

interface TrashSummary {
  ideas: TrashItem[]
  proposals: TrashItem[]
  tasks: TrashItem[]
  transactions: TrashItem[]
  contributions: TrashItem[]
  expenses: TrashItem[]
}

type SectionKey = keyof TrashSummary

interface TrashSection {
  key: SectionKey
  label: string
  // Los tres primeros son papelera de verdad (se pueden restaurar); ideas/propuestas/tareas
  // descartadas o canceladas solo se pueden eliminar definitivamente.
  restorable: boolean
  purgeUrl: (id: string) => string
  restoreUrl?: (id: string) => string
}

const { data, refresh } = await useFetch<TrashSummary>('/api/admin/trash')

const busyId = ref<string | null>(null)
const toast = useToast()

const SECTIONS: TrashSection[] = [
  {
    key: 'transactions',
    label: 'Movimientos bancarios',
    restorable: true,
    purgeUrl: id => `/api/bank/transactions/${id}/purge`,
    restoreUrl: id => `/api/bank/transactions/${id}/restore`
  },
  {
    key: 'contributions',
    label: 'Aportes',
    restorable: true,
    purgeUrl: id => `/api/bank/contributions/${id}/purge`,
    restoreUrl: id => `/api/bank/contributions/${id}/restore`
  },
  {
    key: 'expenses',
    label: 'Gastos',
    restorable: true,
    purgeUrl: id => `/api/expenses/${id}/purge`,
    restoreUrl: id => `/api/expenses/${id}/restore`
  },
  { key: 'ideas', label: 'Ideas descartadas', restorable: false, purgeUrl: id => `/api/ideas/${id}` },
  { key: 'proposals', label: 'Propuestas canceladas', restorable: false, purgeUrl: id => `/api/proposals/${id}` },
  { key: 'tasks', label: 'Tareas descartadas', restorable: false, purgeUrl: id => `/api/tasks/${id}` }
]

// Código de negocio del error (h3 createError → { data: { code } } en el cuerpo de respuesta).
function businessCode(error: unknown): string | undefined {
  return (error as { data?: { data?: { code?: string } } })?.data?.data?.code
}

async function purge(section: TrashSection, item: TrashItem) {
  const confirmed = await useConfirmDialog()({
    title: 'Eliminar definitivamente',
    description: 'Esta acción NO se puede deshacer. El elemento y sus archivos asociados se borran para siempre.',
    confirmLabel: 'Eliminar',
    color: 'error'
  })
  if (!confirmed) return
  busyId.value = item.id
  try {
    await $fetch(section.purgeUrl(item.id), { method: 'DELETE' })
    await refresh()
    toast.add({ title: 'Elemento eliminado definitivamente', color: 'success' })
  } catch (error) {
    toast.add({ title: errorTitle(error, 'No se pudo eliminar definitivamente'), color: 'error' })
  } finally {
    busyId.value = null
  }
}

// Restaurar puede chocar con un duplicado (posible duplicado de aporte): el 409 trae
// `code: 'possible_duplicate'` y el Admin decide si mantener los dos.
async function restore(section: TrashSection, item: TrashItem) {
  if (!section.restoreUrl) return
  busyId.value = item.id
  try {
    const result = await $fetch<{ warnings?: string[] }>(section.restoreUrl(item.id), { method: 'POST' })
    const warning = result?.warnings?.[0]
    toast.add({
      title: warning ?? 'Elemento restaurado',
      color: warning ? 'warning' : 'success'
    })
    await refresh()
  } catch (error) {
    if (businessCode(error) === 'possible_duplicate') {
      const force = await useConfirmDialog()({
        title: 'Restaurar igualmente',
        description: 'Ya existe otro registro idéntico (mismo miembro, importe, tipo y fecha). ¿Mantener los dos?',
        confirmLabel: 'Restaurar igualmente'
      })
      if (force) {
        try {
          await $fetch(section.restoreUrl(item.id), { method: 'POST', body: { force: true } })
          await refresh()
          toast.add({ title: 'Elemento restaurado', color: 'success' })
        } catch (retryError) {
          toast.add({ title: errorTitle(retryError, 'No se pudo restaurar'), color: 'error' })
        }
      }
    } else {
      toast.add({ title: errorTitle(error, 'No se pudo restaurar'), color: 'error' })
    }
  } finally {
    busyId.value = null
  }
}

// El mensaje del servidor explica el conflicto (cuota del mes ya registrada, participante de
// baja, gasto con cuotas pagadas…): se muestra tal cual en vez de un texto genérico.
function errorTitle(error: unknown, fallback: string): string {
  const message = (error as { data?: { statusMessage?: string } })?.data?.statusMessage
  return message && message.length <= 160 ? message : fallback
}

function describe(item: TrashItem): string {
  const parts: string[] = []
  if (item.amountCents !== undefined) parts.push(formatEuros(item.amountCents))
  if (item.date) parts.push(new Date(`${item.date}T00:00:00`).toLocaleDateString('es-ES'))
  parts.push(`En la papelera desde el ${new Date(item.discardedAt).toLocaleDateString('es-ES')}`)
  return parts.join(' · ')
}
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-6 py-10">
    <h1 class="text-xl font-semibold">
      Papelera
    </h1>
    <p class="text-sm text-muted">
      Solo Admin. Movimientos, aportes y gastos eliminados se guardan aquí con sus justificantes:
      puedes restaurarlos o borrarlos definitivamente. Nada se elimina solo.
    </p>

    <UCard
      v-for="section in SECTIONS"
      :key="section.key"
    >
      <template #header>
        <h2 class="text-lg font-semibold">
          {{ section.label }}
        </h2>
      </template>
      <div class="flex flex-col divide-y divide-default">
        <div
          v-for="item in data?.[section.key] ?? []"
          :key="item.id"
          class="flex items-center justify-between gap-3 py-2 text-sm"
        >
          <div class="min-w-0">
            <p class="truncate font-medium">
              {{ item.title }}
            </p>
            <p class="text-muted">
              {{ describe(item) }}
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <UButton
              v-if="section.restorable"
              size="xs"
              color="neutral"
              variant="soft"
              :loading="busyId === item.id"
              @click="restore(section, item)"
            >
              Restaurar
            </UButton>
            <UButton
              size="xs"
              color="error"
              :loading="busyId === item.id"
              @click="purge(section, item)"
            >
              Eliminar definitivamente
            </UButton>
          </div>
        </div>
        <p
          v-if="!(data?.[section.key] ?? []).length"
          class="py-4 text-center text-muted"
        >
          Vacío
        </p>
      </div>
    </UCard>
  </div>
</template>
