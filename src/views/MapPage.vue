<script setup lang="ts">
import { LocateFixed, LoaderCircle, Search, X } from '@lucide/vue'
import { computed, onMounted, ref, watch } from 'vue'
import { onBeforeUnmount } from 'vue'

import MapCanvas from '@/components/MapCanvas.vue'
import TransitSheet from '@/components/TransitSheet.vue'
import Button from '@/components/ui/button/Button.vue'
import Input from '@/components/ui/input/Input.vue'
import { useRideStore } from '@/stores/ride'
import { useTransitStore } from '@/stores/transit'

type SheetMode = 'idle' | 'search' | 'stop' | 'ride' | 'history' | 'support'

interface MapCanvasExposed {
  showUserLocation(longitude: number, latitude: number): void
}

const transit = useTransitStore()
const ride = useRideStore()
const mapCanvas = ref<MapCanvasExposed | null>(null)
const searchQuery = ref('')
const searchOpen = ref(false)
const historyOpen = ref(false)
const supportOpen = ref(false)
const locating = ref(false)
const locationMessage = ref('')
let healthTimer: number | undefined

const sheetMode = computed<SheetMode>(() => {
  if (ride.isActive) return 'ride'
  if (supportOpen.value) return 'support'
  if (historyOpen.value) return 'history'
  if (searchOpen.value) return 'search'
  if (transit.selectedStop) return 'stop'
  return 'idle'
})

const searchResults = computed(() => {
  const normalizedQuery = searchQuery.value.trim().toLocaleLowerCase('ru')
  const stops = transit.stops.features
  if (!normalizedQuery) return stops.slice(0, 6)

  const matchingRouteStopIds = new Set(
    transit.routeStops.routes
      .filter((route) => route.number.toLocaleLowerCase('ru').includes(normalizedQuery))
      .flatMap((route) => route.directions.flatMap((direction) => direction.stopIds)),
  )

  return stops
    .filter(
      (stop) =>
        matchingRouteStopIds.has(stop.properties.id) ||
        `${stop.properties.name} ${stop.properties.shortName}`
          .toLocaleLowerCase('ru')
          .includes(normalizedQuery),
    )
    .slice(0, 6)
})

onMounted(async () => {
  await Promise.all([transit.initialise(), ride.initialise()])
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)
  healthTimer = window.setInterval(transit.refreshApiHealth, 60_000)
})
onBeforeUnmount(() => {
  window.removeEventListener('online', handleOnline)
  window.removeEventListener('offline', handleOffline)
  if (healthTimer !== undefined) window.clearInterval(healthTimer)
})

watch(
  () => transit.selectedStopId,
  (stopId) => {
    if (!stopId) return
    const stop = transit.stopsById.get(stopId)
    if (stop) searchQuery.value = stop.properties.name
    searchOpen.value = false
    historyOpen.value = false
    supportOpen.value = false
  },
)

function selectSearchResult(stopId: string) {
  const stop = transit.stopsById.get(stopId)
  if (stop) searchQuery.value = stop.properties.name
  transit.selectStop(stopId)
  searchOpen.value = false
  historyOpen.value = false
  supportOpen.value = false
}

async function handleOnline() {
  if (await transit.refreshApiHealth()) await ride.trySync()
}

function handleOffline() {
  void transit.refreshApiHealth()
}

function clearSearch() {
  searchQuery.value = ''
  transit.selectStop(null)
  searchOpen.value = true
}

function closeSearch() {
  searchOpen.value = false
  if (!searchQuery.value) transit.selectStop(null)
}

function closeStop() {
  searchQuery.value = ''
  transit.selectStop(null)
}

function openSearch() {
  if (!ride.isActive) searchOpen.value = true
}

function openHistory() {
  transit.selectStop(null)
  searchOpen.value = false
  historyOpen.value = true
  supportOpen.value = false
}

function openSupport() {
  searchOpen.value = false
  historyOpen.value = false
  supportOpen.value = true
}

function closeSupport() {
  supportOpen.value = false
}

function closeHistory() {
  historyOpen.value = false
  supportOpen.value = false
}

function onRideStarted() {
  searchQuery.value = ''
  searchOpen.value = false
  historyOpen.value = false
  transit.selectStop(null)
}

function locateUser() {
  locationMessage.value = ''
  if (!navigator.geolocation) {
    locationMessage.value = 'Геолокация недоступна в этом браузере.'
    return
  }

  locating.value = true
  navigator.geolocation.getCurrentPosition(
    (position) => {
      locating.value = false
      mapCanvas.value?.showUserLocation(position.coords.longitude, position.coords.latitude)
    },
    () => {
      locating.value = false
      locationMessage.value = 'Не удалось определить местоположение.'
    },
    {
      enableHighAccuracy: false,
      timeout: 10_000,
      maximumAge: 60_000,
    },
  )
}
</script>

<template>
  <main class="relative h-full w-full bg-muted">
    <MapCanvas v-if="transit.stops.features.length" ref="mapCanvas" />

    <div class="safe-top fixed inset-x-0 top-0 z-20 flex items-start gap-2 px-2" role="search">
      <div class="relative min-w-0 flex-1">
        <Search
          class="pointer-events-none absolute left-3 top-1/2 z-10 size-5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          v-model="searchQuery"
          class="border-border bg-background pl-10 pr-28 shadow-sm"
          placeholder="Остановка или маршрут"
          autocomplete="off"
          :disabled="ride.isActive"
          @focus="openSearch"
        />
        <span
          v-if="!transit.apiOnline"
          class="pointer-events-none absolute top-1/2 -translate-y-1/2 text-xs font-medium text-red-600"
          :class="searchQuery ? 'right-11' : 'right-3'"
        >
          Оффлайн
        </span>
        <button
          v-if="searchQuery"
          class="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted"
          aria-label="Очистить поиск"
          @click="clearSearch"
        >
          <X class="size-4" />
        </button>
      </div>

      <Button
        variant="outline"
        size="icon"
        class="shrink-0 bg-background shadow-sm"
        :disabled="locating"
        aria-label="Моё местоположение"
        @click="locateUser"
      >
        <LoaderCircle v-if="locating" class="size-5 animate-spin" />
        <LocateFixed v-else class="size-5" />
      </Button>
    </div>

    <TransitSheet
      :mode="sheetMode"
      :search-results="searchResults"
      :location-message="locationMessage"
      @select-stop="selectSearchResult"
      @close-search="closeSearch"
      @close-stop="closeStop"
      @open-history="openHistory"
      @close-history="closeHistory"
      @open-support="openSupport"
      @close-support="closeSupport"
      @ride-started="onRideStarted"
    />
  </main>
</template>
