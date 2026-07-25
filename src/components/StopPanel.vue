<script setup lang="ts">
import { BusFront, ChevronDown, Clock3, Database, Navigation } from '@lucide/vue'

import Badge from '@/components/ui/badge/Badge.vue'
import Button from '@/components/ui/button/Button.vue'
import { confidenceLabel } from '@/lib/forecast'
import type { StopFeature, StopForecast } from '@/types/transit'

defineProps<{
  stop: StopFeature
  forecasts: StopForecast[]
}>()

const emit = defineEmits<{
  close: []
  startRide: [routeId?: string]
}>()
</script>

<template>
  <section
    class="safe-bottom fixed inset-x-2 bottom-2 z-20 max-h-[67vh] overflow-y-auto rounded-[1.4rem] border border-white/70 bg-card/95 p-4 shadow-float backdrop-blur-xl md:bottom-4 md:left-auto md:right-4 md:top-24 md:w-[390px]"
    aria-label="Прогноз для остановки"
  >
    <div class="mx-auto mb-3 h-1 w-10 rounded-full bg-border md:hidden" />
    <div class="flex items-start justify-between gap-3">
      <div>
        <p class="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Остановка
        </p>
        <h2 class="text-xl font-bold tracking-tight">{{ stop.properties.name }}</h2>
      </div>
      <Button
        variant="ghost"
        size="icon"
        class="-mr-2 -mt-2"
        aria-label="Закрыть"
        @click="emit('close')"
      >
        <ChevronDown class="size-5 md:-rotate-90" />
      </Button>
    </div>

    <div class="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
      <Clock3 class="size-4" />
      Прогноз по отметкам пассажиров
    </div>

    <div v-if="forecasts.length" class="mt-3 space-y-2.5">
      <button
        v-for="forecast in forecasts"
        :key="forecast.routeId"
        class="flex w-full items-center gap-3 rounded-xl border border-border/80 bg-background/70 p-3 text-left transition hover:border-primary/30 hover:bg-accent/40"
        @click="emit('startRide', forecast.routeId)"
      >
        <span
          class="flex size-12 shrink-0 items-center justify-center rounded-xl text-lg font-black text-primary"
          :style="{ backgroundColor: `${forecast.route.color}55` }"
        >
          {{ forecast.route.number }}
        </span>
        <span class="min-w-0 flex-1">
          <span class="block text-base font-bold"
            >примерно {{ forecast.minMinutes }}–{{ forecast.maxMinutes }} мин</span
          >
          <span class="mt-0.5 block text-xs text-muted-foreground">
            {{ confidenceLabel(forecast.confidence) }}
          </span>
        </span>
        <Badge class="shrink-0 border-0 bg-muted px-2">
          <Database class="mr-1 size-3" />
          {{ forecast.sampleSize }}
        </Badge>
      </button>
    </div>

    <div v-else class="mt-4 rounded-xl bg-muted p-4 text-sm text-muted-foreground">
      Для этой остановки пока недостаточно исторических отметок.
    </div>

    <Button class="mt-4 w-full" @click="emit('startRide')">
      <BusFront class="size-5" />
      Я еду в автобусе
    </Button>

    <p class="mt-3 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
      <Navigation class="mt-0.5 size-3.5 shrink-0" />
      Это диапазон вероятности, а не точное онлайн-положение автобуса.
    </p>
  </section>
</template>
