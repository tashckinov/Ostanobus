<script setup lang="ts">
import { ArrowLeft, BusFront, Check, MapPin, Search, Square, X } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

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
const savingArrival = ref(false)
const startingRide = ref(false)
const markingStop = ref(false)
const actionMessage = ref('')
const scheduleClock = ref(new Date())
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

async function recordArrival(service: StopService) {
  const stop = transit.selectedStop
  if (!stop) return

  savingArrival.value = true
  actionMessage.value = ''
  try {
    await ride.recordArrival(service.route.routeId, stop.properties.id, service.direction.id)
    actionMessage.value = 'Прибытие сохранено · pending'
  } finally {
    savingArrival.value = false
  }
}

async function startRide(service: StopService) {
  const stop = transit.selectedStop
  if (!stop) return

  startingRide.value = true
  try {
    await ride.startRide(service.route, service.direction, stop.properties.id)
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
          @click="emit('closeStop')"
        >
          <ArrowLeft class="size-5" />
        </Button>
        <h2 class="truncate px-1 text-base font-semibold">
          {{ transit.selectedStop.properties.name }}
        </h2>
      </div>

      <div v-if="selectedStopServices.length">
        <article
          v-for="service in selectedStopServices"
          :key="`${service.route.routeId}-${service.direction.id}`"
          class="border-b border-border px-4 py-3"
        >
          <div class="flex items-start gap-3">
            <span class="w-16 shrink-0 text-base font-semibold">№ {{ service.route.number }}</span>
            <div class="min-w-0 flex-1">
              <p class="truncate text-xs text-muted-foreground">
                {{ service.direction.name || `к ${service.direction.terminal}` }}
              </p>
              <template v-if="service.nextArrival">
                <p class="mt-0.5 text-[15px] font-medium">
                  Ближайший в {{ service.nextArrival.timeLabel }}
                </p>
                <p class="text-xs text-muted-foreground">
                  {{ service.nextArrival.relativeLabel }} · по расписанию
                </p>
              </template>
              <template v-else-if="service.forecast">
                <p class="mt-0.5 text-[15px] font-medium">
                  {{ service.forecast.minMinutes }}–{{ service.forecast.maxMinutes }} мин
                </p>
                <p class="text-xs text-muted-foreground">Вероятностный прогноз</p>
              </template>
              <p v-else class="mt-0.5 text-sm text-muted-foreground">Ближайшее время неизвестно</p>
            </div>
          </div>

          <div class="mt-3 border-t border-border pt-2">
            <p class="text-xs font-medium">Расписание сегодня</p>
            <p
              v-for="label in service.scheduleLabels"
              :key="label"
              class="mt-1 text-sm text-muted-foreground"
            >
              {{ label }}
            </p>
            <p v-if="!service.scheduleLabels.length" class="mt-1 text-sm text-muted-foreground">
              Для этой остановки расписание сегодня не задано.
            </p>
          </div>

          <div class="mt-3 grid grid-cols-2 gap-2">
            <Button :disabled="savingArrival" @click="recordArrival(service)">
              <Check class="size-4" />
              Автобус прибыл
            </Button>
            <Button variant="outline" :disabled="startingRide" @click="startRide(service)">
              <BusFront class="size-4" />
              Я сел
            </Button>
          </div>
        </article>

        <p v-if="actionMessage" class="px-4 py-2 text-xs text-muted-foreground">
          {{ actionMessage }}
        </p>
      </div>

      <p v-else class="px-4 py-4 text-sm text-muted-foreground">
        Через эту остановку активные маршруты пока не проходят.
      </p>
    </div>

    <div v-else-if="mode === 'ride' && ride.activeRide && activeRoute && activeDirection">
      <div class="flex items-start border-b border-border px-4 py-3">
        <div class="flex-1">
          <p class="text-sm text-muted-foreground">
            Маршрут {{ activeRoute.number }} · {{ activeDirection.name }}
          </p>
          <h2 class="mt-1 text-lg font-semibold">
            {{ nextStop ? nextStop.properties.name : 'Конечная остановка' }}
          </h2>
        </div>
        <span class="text-xs text-muted-foreground">{{ ride.pendingCount }} pending</span>
      </div>

      <p
        v-if="ride.justSavedStopId"
        class="flex items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground"
      >
        <Check class="size-4 text-green-600" />
        {{ transit.stopsById.get(ride.justSavedStopId)?.properties.name }} сохранена
      </p>

      <div class="flex gap-2 px-4 pt-3">
        <Button v-if="!rideComplete" class="flex-1" :disabled="markingStop" @click="markNextStop">
          <MapPin class="size-4" />
          Проехали остановку
        </Button>
        <Button v-else class="flex-1" @click="ride.finishRide()">Завершить поездку</Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Завершить поездку"
          @click="ride.finishRide()"
        >
          <Square class="size-4 fill-current" />
        </Button>
      </div>
    </div>
  </section>
</template>
