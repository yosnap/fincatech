<script setup lang="ts">
definePageMeta({ middleware: ['auth'] })

interface SettlementLine {
  debtId: string
  expenseId: string
  description: string
  amountCents: number
  status: string
  createdAt: string
}

interface CounterpartySettlement {
  userId: string
  name: string
  totalSpentCents: number | null
  theyOweMeCents: number
  theyOweMeLines: SettlementLine[]
  iOweThemCents: number
  iOweThemLines: SettlementLine[]
  netCents: number
}

interface Settlement {
  totalTheyOweMeCents: number
  totalIOweThemCents: number
  totalNetCents: number
  counterparties: CounterpartySettlement[]
}

const { data } = await useFetch<Settlement>('/api/settlement')

const DEBT_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  pending_confirmation: 'Pendiente de confirmación'
}

// Clases completas y literales a propósito (no interpolación con `${}`): Tailwind detecta
// utilidades escaneando el texto fuente tal cual, una clase construida dinámicamente en
// runtime no aparece en el CSS generado.
const SUMMARY_CARDS = [
  { key: 'totalTheyOweMeCents', label: 'Te deben en total', icon: 'i-lucide-arrow-down-circle', textClass: 'text-success', ringClass: 'ring-success/25' },
  { key: 'totalIOweThemCents', label: 'Debes en total', icon: 'i-lucide-arrow-up-circle', textClass: 'text-error', ringClass: 'ring-error/25' },
  { key: 'totalNetCents', label: 'Diferencia final', icon: 'i-lucide-scale', textClass: 'text-primary', ringClass: 'ring-primary/25' }
] as const

interface FlatLine extends SettlementLine {
  direction: 'they_owe_me' | 'i_owe_them'
}

// Detalle cronológico combinado: cuotas que me deben y cuotas que debo, intercaladas
// por fecha para que la liquidación se lea como un libro de cuentas.
function linesOf(person: CounterpartySettlement): FlatLine[] {
  return [
    ...person.theyOweMeLines.map(l => ({ ...l, direction: 'they_owe_me' as const })),
    ...person.iOweThemLines.map(l => ({ ...l, direction: 'i_owe_them' as const }))
  ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
}

function netBadgeColor(netCents: number): 'success' | 'error' | 'neutral' {
  if (netCents > 0) return 'success'
  if (netCents < 0) return 'error'
  return 'neutral'
}

function netLabel(netCents: number): string {
  if (netCents > 0) return `Te debe ${formatEuros(netCents)}`
  if (netCents < 0) return `Le debes ${formatEuros(-netCents)}`
  return 'Compensados'
}
</script>

<template>
  <div
    v-if="data"
    class="mx-auto flex max-w-2xl flex-col gap-6 py-10"
  >
    <h1 class="text-xl font-semibold">
      Liquidación de cuentas
    </h1>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <UCard
        v-for="card in SUMMARY_CARDS"
        :key="card.key"
        :class="card.ringClass"
      >
        <div class="flex items-center gap-2">
          <UIcon
            :name="card.icon"
            class="size-4"
            :class="card.textClass"
          />
          <p class="text-sm font-semibold text-highlighted">
            {{ card.label }}
          </p>
        </div>
        <p
          class="mt-1 text-2xl font-bold"
          :class="card.textClass"
        >
          {{ card.key === 'totalNetCents' && data.totalNetCents > 0 ? '+' : '' }}{{ formatEuros(data[card.key]) }}
        </p>
      </UCard>
    </div>

    <p class="text-sm text-muted">
      Para cada persona se compensa lo que te debe (su parte de tus recibos) con lo que le
      debes (tu parte de los suyos). La diferencia final es la cantidad que hay que pagar o cobrar.
    </p>

    <UCard
      v-for="person in data.counterparties"
      :key="person.userId"
    >
      <template #header>
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-lg font-semibold">
            {{ person.name }}
          </h2>
          <UBadge
            :color="netBadgeColor(person.netCents)"
            variant="soft"
          >
            {{ netLabel(person.netCents) }}
          </UBadge>
        </div>
      </template>

      <dl class="flex flex-col gap-1.5 text-sm">
        <div
          v-if="person.totalSpentCents !== null"
          class="flex items-center justify-between"
        >
          <dt class="text-muted">
            Recibos subidos por {{ person.name }}
          </dt>
          <dd class="font-medium">
            {{ formatEuros(person.totalSpentCents) }}
          </dd>
        </div>
        <div class="flex items-center justify-between">
          <dt class="text-muted">
            Tu parte de sus recibos (le debes)
          </dt>
          <dd class="font-medium text-error">
            {{ formatEuros(person.iOweThemCents) }}
          </dd>
        </div>
        <div class="flex items-center justify-between">
          <dt class="text-muted">
            Su parte de tus recibos (te debe)
          </dt>
          <dd class="font-medium text-success">
            {{ formatEuros(person.theyOweMeCents) }}
          </dd>
        </div>
      </dl>

      <div class="mt-4 flex flex-col divide-y divide-default">
        <div
          v-for="line in linesOf(person)"
          :key="line.debtId"
          class="flex items-center justify-between gap-2 py-2 text-sm"
        >
          <div class="min-w-0">
            <NuxtLink
              :to="`/ledger/${line.expenseId}?from=liquidacion`"
              class="font-medium hover:underline"
            >
              {{ line.description }}
            </NuxtLink>
            <p class="text-xs text-muted">
              <UIcon
                :name="line.direction === 'they_owe_me' ? 'i-lucide-arrow-down-right' : 'i-lucide-arrow-up-right'"
                class="size-3"
                :class="line.direction === 'they_owe_me' ? 'text-success' : 'text-error'"
              />
              {{ new Date(line.createdAt).toLocaleDateString('es-ES') }} · {{ DEBT_STATUS_LABELS[line.status] ?? line.status }}
            </p>
          </div>
          <p
            class="shrink-0 font-medium"
            :class="line.direction === 'they_owe_me' ? 'text-success' : 'text-error'"
          >
            {{ formatEuros(line.amountCents) }}
          </p>
        </div>
      </div>
    </UCard>

    <UCard v-if="!data.counterparties.length">
      <p class="py-4 text-center text-muted">
        No hay deudas pendientes con nadie. Todo al día.
      </p>
    </UCard>
  </div>
</template>
