<script setup lang="ts">
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: string
}>()
</script>

<template>
  <span
    :class="
      cn(
        'inline-flex items-center rounded-full border border-border/70 bg-card/85 px-2.5 py-1 text-xs font-medium text-foreground backdrop-blur',
        props.class,
      )
    "
  >
    <slot />
  </span>
</template>
