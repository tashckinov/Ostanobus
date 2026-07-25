<script setup lang="ts">
import { Check, Flag, MapPin, Square } from '@lucide/vue'
import { computed, ref } from 'vue'

import Badge from '@/components/ui/badge/Badge.vue'
import Button from '@/components/ui/button/Button.vue'
import type { ActiveRide, RouteDirection, StopFeature, TransitRoute } from '@/types/transit'

const props = defineProps<{
  ride: ActiveRide
  route: TransitRoute
  direction: RouteDirection
  stopsById: Map<string, StopFeature>
  pendingCount: number
  justSavedStopId: string | null
}>()

const emit = defineEmits<{
  mark: []
  finish: []
}>()

const saving = ref(false)
const nextStopId = computed(() => props.direction.stopIds[props.ride.nextStopIndex])
const nextStop = computed(() =>
  nextStopId.value ? props.stopsById.get(nextStopId.value) : undefined,
)
const lastSavedStop = computed(() =>
  props.justSavedStopId ? props.stopsById.get(props.justSavedStopId) : undefined,
)
const complete = computed(() => props.ride.nextStopIndex >= props.direction.stopIds.length)
const progress = computed(() =>
  Math.round((props.ride.nextStopIndex / props.direction.stopIds.length) * 100),
)

async function mark() {
  saving.value = true
  emit('mark')
  window.setTimeout(() => {
    saving.value = false
  }, 250)
}
</script>

<template>
  <section
    class="safe-bottom fixed inset-x-2 bottom-2 z-30 rounded-[1.4rem] border border-white/70 bg-primary p-4 text-primary-foreground shadow-float md:inset-x-auto md:bottom-4 md:right-4 md:w-[390px]"
    aria-label="Текущая поездка"
  >
    <div class="flex items-start justify-between gap-3">
      <div class="flex items-center gap-3">
        <span
          class="flex size-11 items-center justify-center rounded-xl text-lg font-black text-primary"
          :style="{ backgroundColor: route.color }"
        >
          {{ route.number }}
        </span>
        <div>
          <p class="text-xs text-primary-foreground/65">В пути · {{ direction.name }}</p>
          <p v-if="nextStop" class="font-bold">{{ nextStop.properties.name }}</p>
          <p v-else class="font-bold">Маршрут завершён</p>
        </div>
      </div>
      <Badge class="border-white/15 bg-white/10 text-white"> {{ pendingCount }} локально </Badge>
    </div>

    <div class="mt-4 h-1.5 overflow-hidden rounded-full bg-white/15">
      <div
        class="h-full rounded-full bg-secondary transition-all duration-300"
        :style="{ width: `${progress}%` }"
      />
    </div>

    <p v-if="lastSavedStop" class="mt-3 flex items-center gap-2 text-xs text-primary-foreground/75">
      <Check class="size-4 text-secondary" />
      «{{ lastSavedStop.properties.shortName }}» сохранена на устройстве
    </p>

    <div class="mt-4 flex gap-2">
      <Button v-if="!complete" variant="secondary" class="flex-1" :disabled="saving" @click="mark">
        <MapPin class="size-5" />
        Проехали остановку
      </Button>
      <Button v-else variant="secondary" class="flex-1" @click="emit('finish')">
        <Flag class="size-5" />
        Завершить поездку
      </Button>
      <Button
        variant="ghost"
        size="icon"
        class="border border-white/15 text-white hover:bg-white/10"
        aria-label="Завершить поездку"
        @click="emit('finish')"
      >
        <Square class="size-4 fill-current" />
      </Button>
    </div>
  </section>
</template>
