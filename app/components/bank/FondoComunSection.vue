<script setup lang="ts">
// "Saldo con el fondo común" por miembro: aportado − parte de salidas (partes iguales
// entre miembros activos). Sección additive de la liquidación: no altera las deudas
// pairwise de arriba. Los ingresos externos (Hacienda, IVA…) no se acreditan a nadie:
// quedan en el bote común.

interface FondoComunMember {
  memberId: string
  name: string
  contributedCents: number
  withdrawalsShareCents: number
  balanceCents: number
}

defineProps<{
  fondoComun: FondoComunMember[]
}>()

function balanceColor(balanceCents: number): 'success' | 'error' | 'neutral' {
  if (balanceCents > 0) return 'success'
  if (balanceCents < 0) return 'error'
  return 'neutral'
}

function balanceLabel(balanceCents: number): string {
  if (balanceCents > 0) return `Aportó ${formatEuros(balanceCents)} de más`
  if (balanceCents < 0) return `Debe ${formatEuros(-balanceCents)} al fondo`
  return 'Equilibrado'
}
</script>

<template>
  <section class="flex flex-col gap-4">
    <div>
      <h2 class="text-lg font-semibold">
        Saldo con el fondo común
      </h2>
      <p class="mt-1 text-sm text-muted">
        Por cada miembro: total aportado − su parte de las salidas de la cuenta
        (reparto a partes iguales). Los ingresos externos (devoluciones de Hacienda,
        compensación de IVA…) no se acreditan a nadie: benefician a todos quedándose en
        el bote común.
      </p>
    </div>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <UCard
        v-for="member in fondoComun"
        :key="member.memberId"
      >
        <template #header>
          <div class="flex items-center justify-between gap-2">
            <h3 class="font-semibold">
              {{ member.name }}
            </h3>
            <UBadge
              :color="balanceColor(member.balanceCents)"
              variant="soft"
            >
              {{ balanceLabel(member.balanceCents) }}
            </UBadge>
          </div>
        </template>

        <dl class="flex flex-col gap-1.5 text-sm">
          <div class="flex items-center justify-between">
            <dt class="text-muted">
              Total aportado
            </dt>
            <dd class="font-medium text-success">
              {{ formatEuros(member.contributedCents) }}
            </dd>
          </div>
          <div class="flex items-center justify-between">
            <dt class="text-muted">
              Su parte de las salidas
            </dt>
            <dd class="font-medium text-error">
              −{{ formatEuros(member.withdrawalsShareCents) }}
            </dd>
          </div>
          <div class="mt-1 flex items-center justify-between border-t border-default pt-2">
            <dt class="font-medium">
              Saldo con el fondo
            </dt>
            <dd
              class="font-bold"
              :class="balanceColor(member.balanceCents) === 'success' ? 'text-success' : balanceColor(member.balanceCents) === 'error' ? 'text-error' : ''"
            >
              {{ member.balanceCents > 0 ? '+' : '' }}{{ formatEuros(member.balanceCents) }}
            </dd>
          </div>
        </dl>
      </UCard>
    </div>

    <UCard v-if="!fondoComun.length">
      <p class="py-4 text-center text-muted">
        Sin miembros activos que mostrar.
      </p>
    </UCard>
  </section>
</template>
