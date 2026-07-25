<script setup lang="ts">
import type { InputHTMLAttributes } from 'vue'

import { cn } from '@/lib/utils'

const props = defineProps<{
  modelValue?: string
  type?: InputHTMLAttributes['type']
  placeholder?: string
  class?: InputHTMLAttributes['class']
  autocomplete?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  focus: [event: FocusEvent]
}>()
</script>

<template>
  <input
    :value="props.modelValue"
    :type="props.type ?? 'text'"
    :placeholder="props.placeholder"
    :autocomplete="props.autocomplete"
    :class="
      cn(
        'h-11 w-full rounded-md border border-input bg-background px-3 text-[15px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary',
        props.class,
      )
    "
    @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    @focus="emit('focus', $event)"
  />
</template>
