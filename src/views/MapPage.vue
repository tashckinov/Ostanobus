<script setup lang="ts">
import { AlertTriangle, LocateFixed, LoaderCircle, Menu } from '@lucide/vue'
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
const reportingDelay = ref(false)
const delayMessage = ref('')
let healthTimer: number | undefined
let rideLocationWatch: number | null = null

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

const delayButtonStyle = computed(() => ({
  bottom: `calc(${sheetHeight.value}px + 12px)`,
}))

onMounted(async () => {
  await Promise.all([transit.initialise(), ride.initialise()])
  if (transit.apiOnline) transit.startVehiclePolling()
  if (ride.isActive) startRideTracking()
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)
  healthTimer = window.setInterval(async () => {
    if (await transit.refreshApiHealth()) transit.startVehiclePolling()
    else transit.stopVehiclePolling()
  }, 60_000)
})

onBeforeUnmount(() => {
  window.removeEventListener('online', handleOnline)
  window.removeEventListener('offline', handleOffline)
  transit.stopVehiclePolling()
  stopRideTracking()
  if (healthTimer !== undefined) window.clearInterval(healthTimer)
})

watch(
  () => ride.isActive,
  (isActive) => {
    if (isActive) startRideTracking()
    else stopRideTracking()
  },
)

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
  if (ride.isActive) return
  const stop = transit.stopsById.get(stopId)
  if (stop) searchQuery.value = stop.properties.name
  transit.selectStop(stopId)
  searchOpen.value = false
}

async function handleOnline() {
  if (await transit.refreshApiHealth()) {
    transit.startVehiclePolling()
    await ride.trySync()
  }
}

function handleOffline() {
  transit.stopVehiclePolling()
  void transit.refreshApiHealth()
}

function updateSearch(value: string) {
  if (ride.isActive) return
  searchQuery.value = value
  searchOpen.value = true
}

function clearSearch() {
  if (ride.isActive) return
  searchQuery.value = ''
  transit.selectStop(null)
  searchOpen.value = true
}

function closeStop() {
  if (ride.isActive) return
  searchQuery.value = ''
  transit.selectStop(null)
}

function onRideStarted() {
  searchQuery.value = ''
  searchOpen.value = false
  transit.selectStop(null)
  startRideTracking()
}

function openDrawer() {
  searchOpen.value = false
  drawerOpen.value = true
}

function openSupport() {
  drawerOpen.value = false
  supportOpen.value = true
}

function showPosition(position: GeolocationPosition) {
  locating.value = false
  locationMessage.value = ''
  const { longitude, latitude, heading } = position.coords
  mapCanvas.value?.showUserLocation(longitude, latitude)
  if (ride.isActive) void ride.updateLocation(longitude, latitude, heading)
}

function locateUser() {
  locationMessage.value = ''
  if (!navigator.geolocation) {
    locationMessage.value = 'Геолокация недоступна в этом браузере.'
    return
  }

  locating.value = true
  navigator.geolocation.getCurrentPosition(
    showPosition,
    () => {
      locating.value = false
      locationMessage.value = 'Не удалось определить местоположение.'
    },
    {
      enableHighAccuracy: true,
      timeout: 10_000,
      maximumAge: 15_000,
    },
  )
}

function startRideTracking() {
  if (rideLocationWatch !== null || !navigator.geolocation || !ride.isActive) return
  rideLocationWatch = navigator.geolocation.watchPosition(
    showPosition,
    () => {
      locationMessage.value = 'Сигнал GPS временно потерян. Поездка остаётся активной.'
    },
    {
      enableHighAccuracy: true,
      timeout: 20_000,
      maximumAge: 5_000,
    },
  )
}

function stopRideTracking() {
  if (rideLocationWatch === null || !navigator.geolocation) return
  navigator.geolocation.clearWatch(rideLocationWatch)
  rideLocationWatch = null
}

async function reportActiveRideDelay() {
  const activeRide = ride.activeRide
  if (
    !activeRide ||
    !activeRide.vehicleInstanceId ||
    !activeRide.boardingStopId ||
    !activeRide.scheduledArrival
  ) {
    delayMessage.value = 'Для этого автобуса недостаточно данных о рейсе.'
    return
  }

  reportingDelay.value = true
  delayMessage.value = ''
  try {
    const accepted = await transit.reportDelay(
      activeRide.routeId,
      activeRide.directionId,
      activeRide.boardingStopId,
      activeRide.vehicleInstanceId,
      activeRide.scheduledArrival,
      new Date(),
    )
    delayMessage.value = accepted
      ? 'Спасибо, задержка учтена.'
      : transit.apiOnline
        ? 'Сообщение уже было отправлено или не принято.'
        : 'Для сообщения о задержке требуется интернет.'
  } finally {
    reportingDelay.value = false
  }
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

    <div
      v-if="ride.isActive"
      class="fixed left-3 z-20 max-w-[calc(100%-4.5rem)] transition-[bottom]"
      :style="delayButtonStyle"
    >
      <Button :disabled="reportingDelay" class="shadow-md" @click="reportActiveRideDelay">
        <LoaderCircle v-if="reportingDelay" class="mr-2 size-4 animate-spin" />
        <AlertTriangle v-else class="mr-2 size-4" />
        Автобус опаздывает
      </Button>
      <p v-if="delayMessage" class="mt-1 rounded bg-background px-2 py-1 text-xs shadow">
        {{ delayMessage }}
      </p>
    </div>

    <TransitSheet
      :mode="sheetMode"
      :search-query="searchQuery"
      :search-open="searchOpen"
      :search-results="searchResults"
      :api-online="transit.apiOnline"
      :location-message="locationMessage"
      @update-search="updateSearch"
      @open-search="!ride.isActive && (searchOpen = true)"
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
