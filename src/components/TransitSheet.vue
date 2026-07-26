<script setup lang="ts">
import { ArrowLeft, BusFront, Check, MapPin, Search, X } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import Button from '@/components/ui/button/Button.vue'
import Input from '@/components/ui/input/Input.vue'
import { servicesForStop, type StopService } from '@/lib/schedule'
import { useRideStore } from '@/stores/ride'
import { useTransitStore } from '@/stores/transit'
import type { StopFeature } from '@/types/transit'

type SheetMode = 'idle' | 'stop' | 'ride'

defineProps<{
  mode: SheetMode
  searchQuery: string
  searchOpen: boolean
  searchResults: StopFeature[]
  apiOnline: boolean
  locationMessage?: string
}>()

const emit = defineEmits<{
  updateSearch: [value: string]
  openSearch: []
  clearSearch: []
  selectStop: [stopId: string]
  closeStop: []
  rideStarted: []
  heightChange: [height: number]
}>()

const transit = useTransitStore()
const ride = useRideStore()
const sheet = ref<HTMLElement | null>(null)
const startingRide = ref(false)
const markingStop = ref(false)
const scheduleClock = ref(new Date())
const selectedServiceKey = ref<string | null>(null)
let scheduleClockTimer: ReturnType<typeof setInterval> | null = null
let resizeObserver: ResizeObserver | null = null

const selectedStopServices = computed(() =>
  transit.selectedStopId
    ? servicesForStop(
        transit.selectedStopId,
        transit.routeStops.routes,
        transit.selectedStopForecasts,
        scheduleClock.value,
      )
    : [],
)
const selectedService = computed(
  () =>
    selectedStopServices.value.find(
      (service) => serviceKey(service) === selectedServiceKey.value,
    ) ?? null,
)
const activeRoute = computed(() =>
  ride.activeRide
    ? transit.routeStops.routes.find((route) => route.routeId === ride.activeRide?.routeId)
    : undefined,
)
const activeDirection = computed(() =>
  ride.activeRide && activeRoute.value
    ? activeRoute.value.directions.find(
        (direction) => direction.id === ride.activeRide?.directionId,
      )
    : undefined,
)
const nextStop = computed(() => {
  if (!ride.activeRide || !activeDirection.value) return undefined
  const stopId = activeDirection.value.stopIds[ride.activeRide.nextStopIndex]
  return stopId ? transit.stopsById.get(stopId) : undefined
})
const rideComplete = computed(
  () =>
    Boolean(ride.activeRide && activeDirection.value) &&
    ride.activeRide!.nextStopIndex >= activeDirection.value!.stopIds.length,
)

watch(
  () => transit.selectedStopId,
  () => {
    selectedServiceKey.value = null
  },
)

function serviceKey(service: StopService) {
  return `${service.route.routeId}-${service.direction.id}`
}

function arrivalLabel(service: StopService) {
  if (service.nextArrival) return service.nextArrival.relativeLabel
  if (service.forecast) {
    return `через ${service.forecast.minMinutes}–${service.forecast.maxMinutes} мин`
  }
  return 'Нет данных'
}

function arrivalDetails(service: StopService) {
  if (service.nextArrival) return `в ${service.nextArrival.timeLabel}`
  if (service.forecast) return 'вероятностный прогноз'
  return ''
}

function goBackFromStop() {
  if (selectedServiceKey.value) {
    selectedServiceKey.value = null
    return
  }
  emit('closeStop')
}

async function startRide(service: StopService) {
  const stop = transit.selectedStop
  if (!stop) return

  startingRide.value = true
  try {
    await ride.boardBus(service.route, service.direction, stop.properties.id)
    emit('rideStarted')
  } finally {
    startingRide.value = false
  }
}

async function markNextStop() {
  if (!activeDirection.value) return
  markingStop.value = true
  try {
    await ride.markNextStop(activeDirection.value)
  } finally {
    markingStop.value = false
  }
}

onMounted(() => {
  scheduleClockTimer = setInterval(() => {
    scheduleClock.value = new Date()
  }, 30_000)
  if (sheet.value) {
    resizeObserver = new ResizeObserver(([entry]) => {
      if (entry) emit('heightChange', Math.ceil(entry.target.getBoundingClientRect().height))
    })
    resizeObserver.observe(sheet.value)
  }
})
onBeforeUnmount(() => {
  if (scheduleClockTimer) clearInterval(scheduleClockTimer)
  resizeObserver?.disconnect()
})
</script>

<template>
  <section
    ref="sheet"
    class="safe-bottom fixed inset-x-0 bottom-0 z-30 max-h-[62vh] overflow-y-auto rounded-t-md border-t border-border bg-background"
    aria-live="polite"
  >
    <div v-if="transit.loading" class="px-4 py-4 text-sm text-muted-foreground">
      Загружаем данные…
    </div>

    <div v-else-if="transit.error" class="px-4 py-3">
      <p class="text-sm">{{ transit.error }}</p>
      <Button variant="outline" size="sm" class="mt-2" @click="transit.initialise()">
        Повторить
      </Button>
    </div>

    <div v-else-if="mode === 'idle'" class="px-3 pt-2">
      <div class="relative">
        <Search
          class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          :model-value="searchQuery"
          class="h-10 pl-9 pr-20"
          placeholder="Остановка или маршрут"
          autocomplete="off"
          @update:model-value="emit('updateSearch', $event)"
          @focus="emit('openSearch')"
        />
        <span
          v-if="!apiOnline && !searchQuery"
          class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-red-600"
        >
          Оффлайн
        </span>
        <button
          v-if="searchQuery"
          class="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted"
          aria-label="Очистить поиск"
          @click="emit('clearSearch')"
        >
          <X class="size-4" />
        </button>
      </div>

      <p v-if="locationMessage" class="px-1 pt-2 text-xs text-red-600">
        {{ locationMessage }}
      </p>

      <div v-if="searchOpen" class="mt-2 border-t border-border">
        <button
          v-for="stop in searchResults"
          :key="stop.properties.id"
          class="flex min-h-12 w-full items-center gap-3 border-b border-border px-1 py-2 text-left hover:bg-muted"
          @click="emit('selectStop', stop.properties.id)"
        >
          <MapPin class="size-4 shrink-0 text-muted-foreground" />
          <span class="flex-1 text-sm">{{ stop.properties.name }}</span>
        </button>
        <p v-if="!searchResults.length" class="py-4 text-sm text-muted-foreground">
          Остановки не найдены
        </p>
      </div>
    </div>

    <div v-else-if="mode === 'stop' && transit.selectedStop">
      <div
        class="sticky top-0 z-10 flex h-12 items-center border-b border-border bg-background px-2"
      >
        <Button
          variant="ghost"
          size="icon"
          class="size-10"
          aria-label="Назад"
          @click="goBackFromStop"
        >
          <ArrowLeft class="size-5" />
        </Button>
        <h2 class="truncate px-1 text-base font-semibold">
          {{ transit.selectedStop.properties.name }}
        </h2>
      </div>

      <div v-if="selectedService" class="px-4 py-3">
        <article>
          <div class="flex items-start gap-3">
            <span
              class="inline-flex min-w-12 shrink-0 items-center justify-center rounded px-2 py-1 text-sm font-bold text-white"
              :style="{ backgroundColor: selectedService.route.color }"
            >
              № {{ selectedService.route.number }}
            </span>
            <div class="min-w-0 flex-1">
              <p class="truncate text-xs text-muted-foreground">
                {{ selectedService.direction.name || `к ${selectedService.direction.terminal}` }}
              </p>
              <template v-if="selectedService.nextArrival">
                <p class="mt-1 text-2xl font-semibold leading-none">
                  {{ selectedService.nextArrival.relativeLabel }}
                </p>
                <p class="mt-1 text-base font-medium">
                  Ближайший в {{ selectedService.nextArrival.timeLabel }}
                  <span class="text-xs font-normal text-muted-foreground">· по расписанию</span>
                </p>
              </template>
              <template v-else-if="selectedService.forecast">
                <p class="mt-1 text-2xl font-semibold leading-none">
                  через {{ selectedService.forecast.minMinutes }}–{{
                    selectedService.forecast.maxMinutes
                  }}
                  мин
                </p>
                <p class="text-xs text-muted-foreground">Вероятностный прогноз</p>
              </template>
              <p v-else class="mt-0.5 text-sm text-muted-foreground">Ближайшее время неизвестно</p>
            </div>
          </div>

          <div class="mt-3 border-t border-border pt-2">
            <p class="text-xs font-medium">Расписание сегодня</p>
            <p
              v-for="label in selectedService.scheduleLabels"
              :key="label"
              class="mt-1 text-sm text-muted-foreground"
            >
              {{ label }}
            </p>
            <p
              v-if="!selectedService.scheduleLabels.length"
              class="mt-1 text-sm text-muted-foreground"
            >
              Для этой остановки расписание сегодня не задано.
            </p>
          </div>

          <div class="mt-3">
            <Button class="w-full" :disabled="startingRide" @click="startRide(selectedService)">
              <BusFront class="size-4" />
              Я сел
            </Button>
          </div>
        </article>
      </div>

      <div v-else-if="selectedStopServices.length">
        <button
          v-for="service in selectedStopServices"
          :key="serviceKey(service)"
          class="flex min-h-16 w-full items-center gap-3 border-b border-border px-3 py-2 text-left hover:bg-muted"
          @click="selectedServiceKey = serviceKey(service)"
        >
          <span
            class="inline-flex min-w-12 shrink-0 items-center justify-center rounded px-2 py-1 text-sm font-bold text-white"
            :style="{ backgroundColor: service.route.color }"
          >
            № {{ service.route.number }}
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium">
              {{ service.direction.name || `к ${service.direction.terminal}` }}
            </span>
            <span class="mt-0.5 block truncate text-xs text-muted-foreground">
              {{ service.scheduleLabels[0] || 'Расписание не задано' }}
            </span>
          </span>
          <span class="shrink-0 text-right">
            <span class="block text-sm font-semibold">{{ arrivalLabel(service) }}</span>
            <span class="mt-0.5 block text-xs text-muted-foreground">
              {{ arrivalDetails(service) }}
            </span>
          </span>
        </button>
      </div>

      <p v-else class="px-4 py-4 text-sm text-muted-foreground">
        Через эту остановку активные маршруты пока не проходят.
      </p>
    </div>

    <div v-else-if="mode === 'ride' && ride.activeRide && activeRoute && activeDirection">
      <div class="border-b border-border px-4 py-3">
        <div class="flex-1">
          <p class="text-lg font-semibold">Вы едете на {{ activeRoute.number }}</p>
          <p class="text-sm text-muted-foreground">{{ activeDirection.name }}</p>
          <p class="mt-2 text-base">
            Следующая:
            <span class="font-semibold">
              {{ nextStop ? nextStop.properties.name : 'конечная остановка' }}
            </span>
          </p>
        </div>
      </div>

      <p
        v-if="ride.justSavedStopId"
        class="flex items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground"
      >
        <Check class="size-4 text-green-600" />
        {{ transit.stopsById.get(ride.justSavedStopId)?.properties.name }} сохранена
      </p>

      <div class="px-4 pt-3">
        <p v-if="!rideComplete" class="mb-2 text-xs text-muted-foreground">
          Не удалось точно определить остановку? Нажмите «Мы проехали остановку».
        </p>
        <Button
          v-if="!rideComplete"
          variant="outline"
          class="w-full"
          :disabled="markingStop"
          @click="markNextStop"
        >
          <MapPin class="size-4" />
          Мы проехали остановку
        </Button>
        <Button class="mt-2 w-full" @click="ride.finishRide()"> Я вышел </Button>
      </div>
    </div>
  </section>
</template>
