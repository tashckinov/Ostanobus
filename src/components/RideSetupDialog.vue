<script setup lang="ts">
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'radix-vue'
import { ArrowRight, BusFront, X } from '@lucide/vue'
import { computed, ref, watch } from 'vue'

import Button from '@/components/ui/button/Button.vue'
import { cn } from '@/lib/utils'
import type { RouteDirection, TransitRoute } from '@/types/transit'

const props = defineProps<{
  open: boolean
  routes: TransitRoute[]
  suggestedRouteId?: string
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  start: [route: TransitRoute, direction: RouteDirection]
}>()

const selectedRouteId = ref('')
const selectedDirectionId = ref('')

const selectedRoute = computed(() =>
  props.routes.find((route) => route.routeId === selectedRouteId.value),
)

watch(
  () => [props.open, props.suggestedRouteId] as const,
  ([open, suggestedRouteId]) => {
    if (!open) return
    selectedRouteId.value = suggestedRouteId ?? props.routes[0]?.routeId ?? ''
    selectedDirectionId.value = ''
  },
)

watch(selectedRouteId, () => {
  selectedDirectionId.value = ''
})

function startRide() {
  const route = selectedRoute.value
  const direction = route?.directions.find((item) => item.id === selectedDirectionId.value)
  if (!route || !direction) return
  emit('start', route, direction)
}
</script>

<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-primary/35 backdrop-blur-sm" />
      <DialogContent
        class="safe-bottom fixed inset-x-0 bottom-0 z-50 max-h-[90vh] overflow-y-auto rounded-t-[1.7rem] border border-border bg-card p-5 shadow-float focus:outline-none sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[460px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[1.7rem]"
      >
        <div class="mb-5 flex items-start justify-between gap-4">
          <div>
            <DialogTitle class="text-xl font-bold">Начать поездку</DialogTitle>
            <DialogDescription class="mt-1 text-sm text-muted-foreground">
              Выберите маршрут и направление
            </DialogDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            class="-mr-2 -mt-2"
            @click="emit('update:open', false)"
          >
            <X class="size-5" />
          </Button>
        </div>

        <p class="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Маршрут
        </p>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="route in routes"
            :key="route.routeId"
            :class="
              cn(
                'flex items-center gap-3 rounded-xl border p-3 text-left transition',
                selectedRouteId === route.routeId
                  ? 'border-primary bg-accent/60 ring-1 ring-primary'
                  : 'border-border bg-background hover:bg-muted',
              )
            "
            @click="selectedRouteId = route.routeId"
          >
            <span
              class="flex size-10 items-center justify-center rounded-lg font-black"
              :style="{ backgroundColor: `${route.color}66` }"
            >
              {{ route.number }}
            </span>
            <span class="text-sm font-semibold">Автобус</span>
          </button>
        </div>

        <template v-if="selectedRoute">
          <p
            class="mb-2 mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground"
          >
            Направление
          </p>
          <div class="space-y-2">
            <button
              v-for="direction in selectedRoute.directions"
              :key="direction.id"
              :class="
                cn(
                  'flex w-full items-center justify-between rounded-xl border p-4 text-left transition',
                  selectedDirectionId === direction.id
                    ? 'border-primary bg-accent/60 ring-1 ring-primary'
                    : 'border-border bg-background hover:bg-muted',
                )
              "
              @click="selectedDirectionId = direction.id"
            >
              <span>
                <span class="block text-xs text-muted-foreground">В сторону</span>
                <span class="font-bold">{{ direction.terminal }}</span>
              </span>
              <ArrowRight class="size-5" />
            </button>
          </div>
        </template>

        <Button class="mt-5 w-full" :disabled="!selectedDirectionId" @click="startRide">
          <BusFront class="size-5" />
          Начать поездку
        </Button>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
