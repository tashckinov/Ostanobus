<script setup lang="ts">
import type { ButtonHTMLAttributes } from 'vue'

import { cn } from '@/lib/utils'

type Variant = 'default' | 'secondary' | 'outline' | 'ghost'
type Size = 'default' | 'sm' | 'icon'

const props = withDefaults(
  defineProps<{
    variant?: Variant
    size?: Size
    class?: ButtonHTMLAttributes['class']
    disabled?: boolean
    type?: ButtonHTMLAttributes['type']
  }>(),
  {
    variant: 'default',
    size: 'default',
    type: 'button',
  },
)

const variantClasses: Record<Variant, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/92',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  outline: 'border border-border bg-card/90 hover:bg-accent',
  ghost: 'hover:bg-accent hover:text-accent-foreground',
}

const sizeClasses: Record<Size, string> = {
  default: 'h-12 px-5 py-2',
  sm: 'h-9 rounded-md px-3',
  icon: 'h-11 w-11',
}
</script>

<template>
  <button
    :type="props.type"
    :disabled="props.disabled"
    :class="
      cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
        variantClasses[props.variant],
        sizeClasses[props.size],
        props.class,
      )
    "
  >
    <slot />
  </button>
</template>
