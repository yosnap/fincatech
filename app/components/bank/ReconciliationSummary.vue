<script setup lang="ts">
// Tarjetas del resumen de conciliación: saldo actual, saldo pre-compra y las dos alertas
// de descuadre (efectivo sin depositar e ingresos sin origen). El saldo nunca se edita:
// se calcula sumando movimientos.

interface CashPendingItem {
  id: string
  memberId: string
  memberName: string
  amountCents: number
  date: string
}

interface UnmatchedDeposit {
  id: string
  date: string
  amountCents: number
  description: string
}

interface Props {
  currentCents: number
  prePurchaseCents: number
  purchaseDate: string | null
  cashPendingCents: number
  cashPending: CashPendingItem[]
  unmatchedDeposits: UnmatchedDeposit[]
}

defineProps<Props>()
</script>

<template>
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
    <UCard>
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-landmark"
          class="size-4 text-primary"
        />
        <p class="text-sm font-semibold text-highlighted">
          Saldo actual
        </p>
      </div>
      <p class="mt-1 text-2xl font-bold text-primary">
        {{ formatEuros(currentCents) }}
      </p>
      <p class="mt-1 text-xs text-muted">
        Calculado sumando ingresos y salidas — nunca se introduce a mano.
      </p>
    </UCard>

    <UCard>
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-calendar-clock"
          class="size-4 text-muted"
        />
        <p class="text-sm font-semibold text-highlighted">
          Saldo a fecha de compra
        </p>
      </div>
      <p class="mt-1 text-2xl font-bold text-highlighted">
        {{ formatEuros(prePurchaseCents) }}
      </p>
      <p class="mt-1 text-xs text-muted">
        {{ purchaseDate ? `Movimientos anteriores al ${new Date(purchaseDate).toLocaleDateString('es-ES')}` : 'Sin fecha de compra configurada' }}
      </p>
    </UCard>

    <UCard :class="cashPendingCents > 0 ? 'ring-warning/40' : ''">
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-hand-coins"
          class="size-4"
          :class="cashPendingCents > 0 ? 'text-warning' : 'text-muted'"
        />
        <p class="text-sm font-semibold text-highlighted">
          Efectivo sin depositar
        </p>
      </div>
      <p
        class="mt-1 text-2xl font-bold"
        :class="cashPendingCents > 0 ? 'text-warning' : 'text-highlighted'"
      >
        {{ formatEuros(cashPendingCents) }}
      </p>
      <ul
        v-if="cashPending.length"
        class="mt-2 flex flex-col gap-1 text-xs text-muted"
      >
        <li
          v-for="item in cashPending"
          :key="item.id"
        >
          {{ item.memberName }} · {{ formatEuros(item.amountCents) }} · {{ new Date(item.date).toLocaleDateString('es-ES') }}
        </li>
      </ul>
      <p
        v-if="!cashPending.length && cashPendingCents === 0"
        class="mt-1 text-xs text-muted"
      >
        Todo el efectivo recogido está en el banco.
      </p>
    </UCard>

    <UCard :class="unmatchedDeposits.length > 0 ? 'ring-warning/40' : ''">
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-circle-help"
          class="size-4"
          :class="unmatchedDeposits.length > 0 ? 'text-warning' : 'text-muted'"
        />
        <p class="text-sm font-semibold text-highlighted">
          Ingresos sin aporte asociado
        </p>
      </div>
      <p
        class="mt-1 text-2xl font-bold"
        :class="unmatchedDeposits.length > 0 ? 'text-warning' : 'text-highlighted'"
      >
        {{ unmatchedDeposits.length }}
      </p>
      <ul
        v-if="unmatchedDeposits.length"
        class="mt-2 flex flex-col gap-1 text-xs text-muted"
      >
        <li
          v-for="deposit in unmatchedDeposits"
          :key="deposit.id"
        >
          {{ new Date(deposit.date).toLocaleDateString('es-ES') }} · {{ formatEuros(deposit.amountCents) }} · {{ deposit.description }}
        </li>
      </ul>
      <p
        v-else
        class="mt-1 text-xs text-muted"
      >
        Todos los ingresos tienen origen conocido.
      </p>
    </UCard>
  </div>
</template>
