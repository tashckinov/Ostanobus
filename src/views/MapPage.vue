<script setup lang="ts">
import { LocateFixed, LoaderCircle, Menu } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import AppDrawer from '@/components/AppDrawer.vue'
import MapCanvas from '@/components/MapCanvas.vue'
import SupportSheet from '@/components/SupportSheet.vue'
import TransitSheet from '@/components/TransitSheet.vue'
import Button from '@/components/ui/button/Button.vue'
import { useRideStore } from '@/stores/ride'
import { useTransitStore } from '@/stores/transit'

type SheetMode = 'idle' | 'stop' | 'ride'

interface MapCanvasExposed {
  showUserLocation(longitude: number, latitude: number): void
}

const transit = useTransitStore()
const ride = useRideStore()
const mapCanvas = ref<MapCanvasExposed | null>(null)
const drawerOpen = ref(false)
const supportOpen = ref(false)
const searchQuery = ref('')
const searchOpen = ref(false)
const locating = ref(false)
const locationMessage = ref('')
const sheetHeight = ref(72)
let healthTimer: number | undefined

const sheetMode = computed<SheetMode>(() => {
  if (ride.isActive) return 'ride'
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

const locationButtonStyle = computed(() => ({
  bottom: `calc(${sheetHeight.value}px + 12px)`,
}))

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
  },
)

function selectSearchResult(stopId: string) {
  const stop = transit.stopsById.get(stopId)
  if (stop) searchQuery.value = stop.properties.name
  transit.selectStop(stopId)
  searchOpen.value = false
}

async function handleOnline() {
  if (await transit.refreshApiHealth()) await ride.trySync()
}

function handleOffline() {
  void transit.refreshApiHealth()
}

function updateSearch(value: string) {
  searchQuery.value = value
  if (!ride.isActive) searchOpen.value = true
}

function clearSearch() {
  searchQuery.value = ''
  transit.selectStop(null)
  searchOpen.value = true
}

function closeStop() {
  searchQuery.value = ''
  transit.selectStop(null)
}

function onRideStarted() {
  searchQuery.value = ''
  searchOpen.value = false
  transit.selectStop(null)
}

function openDrawer() {
  searchOpen.value = false
  drawerOpen.value = true
}

function openSupport() {
  drawerOpen.value = false
  supportOpen.value = true
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

    <div class="safe-top fixed left-2 top-0 z-20">
      <Button
        variant="outline"
        size="icon"
        class="bg-background shadow-sm"
        aria-label="Открыть меню"
        @click="openDrawer"
      >
        <Menu class="size-5" />
      </Button>
    </div>

    <Button
      variant="outline"
      size="icon"
      class="fixed right-3 z-20 bg-background shadow-sm transition-[bottom]"
      :style="locationButtonStyle"
      :disabled="locating"
      aria-label="Моё местоположение"
      @click="locateUser"
    >
      <LoaderCircle v-if="locating" class="size-5 animate-spin" />
      <LocateFixed v-else class="size-5" />
    </Button>

    <TransitSheet
      :mode="sheetMode"
      :search-query="searchQuery"
      :search-open="searchOpen"
      :search-results="searchResults"
      :api-online="transit.apiOnline"
      :location-message="locationMessage"
      @update-search="updateSearch"
      @open-search="searchOpen = true"
      @clear-search="clearSearch"
      @select-stop="selectSearchResult"
      @close-stop="closeStop"
      @ride-started="onRideStarted"
      @height-change="sheetHeight = $event"
    />

    <AppDrawer v-model:open="drawerOpen" @open-support="openSupport" />
    <SupportSheet v-model:open="supportOpen" />
  </main>
</template>
