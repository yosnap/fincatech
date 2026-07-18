<script setup lang="ts">
interface BarItem {
  label: string
  valueCents: number
}

const props = withDefaults(defineProps<{
  items: BarItem[]
  color?: string
}>(), {
  color: 'bg-primary'
})

const hoveredIndex = ref<number | null>(null)

const maxValue = computed(() => Math.max(1, ...props.items.map(i => i.valueCents)))

function barHeightPercent(valueCents: number): number {
  return Math.max(2, Math.round((valueCents / maxValue.value) * 100))
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex h-40 gap-2 border-b border-default">
      <div
        v-for="(item, index) in items"
        :key="item.label"
        class="relative flex flex-1 flex-col items-center justify-end"
        @mouseenter="hoveredIndex = index"
        @mouseleave="hoveredIndex = null"
      >
        <div
          v-if="hoveredIndex === index"
          class="absolute -top-7 z-10 rounded-md bg-inverted px-2 py-1 text-xs whitespace-nowrap text-inverted"
        >
          {{ formatEuros(item.valueCents) }}
        </div>
        <div
          class="w-full rounded-t transition-opacity"
          :class="[color, hoveredIndex !== null && hoveredIndex !== index ? 'opacity-50' : 'opacity-100']"
          :style="{ height: `${barHeightPercent(item.valueCents)}%` }"
        />
      </div>
    </div>
    <div class="flex gap-2">
      <p
        v-for="item in items"
        :key="item.label"
        class="flex-1 text-center text-xs text-muted"
      >
        {{ item.label }}
      </p>
    </div>
  </div>
</template>
