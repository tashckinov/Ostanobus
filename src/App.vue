<script setup lang="ts">
import { useRegisterSW } from 'virtual:pwa-register/vue'
import { WifiOff } from '@lucide/vue'
import { RouterView } from 'vue-router'
import { useOnline } from '@vueuse/core'

import Badge from '@/components/ui/badge/Badge.vue'

const online = useOnline()

useRegisterSW({
  immediate: true,
})
</script>

<template>
  <main class="h-full w-full">
    <RouterView />

    <Transition
      enter-active-class="transition duration-200"
      enter-from-class="-translate-y-2 opacity-0"
      leave-active-class="transition duration-150"
      leave-to-class="-translate-y-2 opacity-0"
    >
      <Badge
        v-if="!online"
        class="fixed left-1/2 top-[max(4.8rem,env(safe-area-inset-top))] z-50 -translate-x-1/2 border-amber-300 bg-amber-100 text-amber-950 shadow"
      >
        <WifiOff class="mr-1.5 size-3.5" />
        Без сети — отметки сохраняются
      </Badge>
    </Transition>
  </main>
</template>
