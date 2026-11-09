<script setup lang="ts">
// Posibles aportes duplicados (mismo miembro, importe, tipo, fecha y período), solo Admin.
// El primero de cada grupo es el más antiguo (suele ser el original); el resto se puede
// eliminar desde aquí con el mismo flujo de borrado de la lista.

export interface DuplicateItem {
  id: string
  memberId: string
  memberName: string
  amountCents: number
  type: string
  period: string | null
  method: string
  date: string
  bankTransactionId: string | null
  registeredByName: string
  notes: string | null
  createdAt: string
}

defineProps<{ groups: DuplicateItem[][] }>()

const emit = defineEmits<{ delete: [item: DuplicateItem] }>()

const TYPE_LABELS: Record<string, string> = {
  pre_purchase: 'Pre-compra',
  quota: 'Cuota',
  extraordinary: 'Extraordinario'
}

function formatCreatedAt(value: string): string {
  return new Date(value).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'medium' })
}
</script>

<template>
  <UCard
    v-if="groups.length"
    :ui="{ root: 'ring-warning/40 bg-warning/5' }"
  >
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-copy"
          class="size-5 text-warning"
        />
        <h2 class="font-semibold">
          Posibles aportes duplicados ({{ groups.length }})
        </h2>
      </div>
      <p class="mt-1 text-sm text-muted">
        Aportes con el mismo miembro, importe, tipo y fecha. Revisa la hora de registro y elimina el sobrante si es un error.
      </p>
    </template>

    <div class="flex flex-col gap-4">
      <div
        v-for="(group, index) in groups"
        :key="index"
        class="flex flex-col divide-y divide-default rounded-md border border-default"
      >
        <div
          v-for="(item, position) in group"
          :key="item.id"
          class="flex items-center justify-between gap-2 px-3 py-2"
        >
          <div class="min-w-0 text-sm">
            <p class="font-medium">
              {{ item.memberName }}
              <span class="font-normal text-muted">
                · {{ TYPE_LABELS[item.type] ?? item.type }}
                <template v-if="item.period"> · {{ item.period }}</template>
                · {{ formatEuros(item.amountCents) }}
                · {{ new Date(item.date).toLocaleDateString('es-ES') }}
              </span>
            </p>
            <p class="text-muted">
              Registrado {{ formatCreatedAt(item.createdAt) }} por {{ item.registeredByName }}
              <template v-if="item.bankTransactionId">
                · vinculado a ingreso
              </template>
              <template v-if="item.notes">
                · {{ item.notes }}
              </template>
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-1.5">
            <UBadge
              v-if="position === 0"
              color="neutral"
              variant="soft"
              size="sm"
            >
              Más antiguo
            </UBadge>
            <UButton
              icon="i-lucide-trash-2"
              color="neutral"
              variant="ghost"
              size="sm"
              aria-label="Eliminar este aporte"
              title="Eliminar este aporte"
              @click="emit('delete', item)"
            />
          </div>
        </div>
      </div>
    </div>
  </UCard>
</template>
