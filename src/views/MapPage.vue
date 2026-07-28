<script setup lang="ts">
import { AlertTriangle, LocateFixed, LoaderCircle, Menu, Navigation, X } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import AppDrawer from '@/components/AppDrawer.vue'
import MapCanvas from '@/components/MapCanvas.vue'
import SupportSheet from '@/components/SupportSheet.vue'
import TransitSheet from '@/components/TransitSheet.vue'
import Button from '@/components/ui/button/Button.vue'
import { useRideStore } from '@/stores/ride'
import { useTransitStore } from '@/stores/transit'

interface MapCanvasExposed {
  showUserLocation(longitude: number, latitude: number): void
  resumeRideFollowing(): void
}

type SheetMode = 'idle' | 'stop' | 'ride'

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
const selectedVehicleId = ref<string | null>(null)
const reportingDelay = ref(false)
const delayMessage = ref('')
let healthTimer: number | undefined

const sheetMode = computed<SheetMode>(() => {
  if (ride.isActive) return 'ride'
  if (transit.selectedStop) return 'stop'
  return 'idle'
})

const searchResults = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase('ru')
  const stops = transit.stops.features
  if (!query) return stops.slice(0, 6)
  const routeStopIds = new Set(
    transit.routeStops.routes
      .filter((route) => route.number.toLocaleLowerCase('ru').includes(query))
      .flatMap((route) => route.directions.flatMap((direction) => direction.stopIds)),
  )
  return stops
    .filter(
      (stop) =>
        routeStopIds.has(stop.properties.id) ||
        `${stop.properties.name} ${stop.properties.shortName}`
          .toLocaleLowerCase('ru')
          .includes(query),
    )
    .slice(0, 6)
})

const floatingButtonStyle = computed(() => ({
  bottom: `calc(${sheetHeight.value}px + 12px)`,
}))

const activeVehicleSelected = computed(
  () =>
    Boolean(ride.activeRide?.vehicleInstanceId) &&
    selectedVehicleId.value === ride.activeRide?.vehicleInstanceId,
)

onMounted(async () => {
  await Promise.all([transit.initialise(), ride.initialise()])
  transit.setInteractionLocked(ride.isActive)
  if (transit.apiOnline) transit.startVehiclePolling()
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
  if (healthTimer !== undefined) window.clearInterval(healthTimer)
})

watch(
  () => ride.isActive,
  (active) => {
    transit.setInteractionLocked(active)
    if (!active) selectedVehicleId.value = null
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

function selectSearchResult(stopId: string) {
  if (ride.isActive) return
  const stop = transit.stopsById.get(stopId)
  if (stop) searchQuery.value = stop.properties.name
  transit.selectStop(stopId)
  searchOpen.value = false
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
  transit.setInteractionLocked(true)
  selectedVehicleId.value = null
  mapCanvas.value?.resumeRideFollowing()
}

function locateUser() {
  if (ride.isActive) {
    mapCanvas.value?.resumeRideFollowing()
    return
  }
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
    { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
  )
}

function selectVehicle(vehicleId: string) {
  if (!ride.isActive || vehicleId !== ride.activeRide?.vehicleInstanceId) return
  selectedVehicleId.value = vehicleId
  delayMessage.value = ''
}

async function reportDelay() {
  const activeRide = ride.activeRide
  if (
    !activeRide?.vehicleInstanceId ||
    !activeRide.boardingStopId ||
    !activeRide.scheduledArrival
  ) {
    delayMessage.value = 'Для этого рейса недостаточно данных.'
    return
  }
  reportingDelay.value = true
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
        : 'Для отправки требуется интернет.'
  } finally {
    reportingDelay.value = false
  }
}
</script>

<template>
  <main class="relative h-full w-full bg-muted">
    <MapCanvas
      v-if="transit.stops.features.length"
      ref="mapCanvas"
      @vehicle-click="selectVehicle"
    />

    <div class="safe-top fixed left-2 top-0 z-20">
      <Button
        variant="outline"
        size="icon"
        class="bg-background shadow-sm"
        aria-label="Открыть меню"
        @click="drawerOpen = true"
      >
        <Menu class="size-5" />
      </Button>
    </div>

    <Button
      variant="outline"
      size="icon"
      class="fixed right-3 z-20 bg-background shadow-sm transition-[bottom]"
      :style="floatingButtonStyle"
      :disabled="locating"
      :aria-label="ride.isActive ? 'Вернуться к автобусу' : 'Моё местоположение'"
      @click="locateUser"
    >
      <LoaderCircle v-if="locating" class="size-5 animate-spin" />
      <Navigation v-else-if="ride.isActive" class="size-5" />
      <LocateFixed v-else class="size-5" />
    </Button>

    <div
      v-if="activeVehicleSelected"
      class="fixed left-3 right-16 z-30 rounded-md border border-border bg-background p-3 shadow-lg transition-[bottom]"
      :style="floatingButtonStyle"
    >
      <div class="flex items-start justify-between gap-2">
        <div>
          <p class="font-semibold">Ваш автобус</p>
          <p class="text-xs text-muted-foreground">Нажат выбранный автобус на карте</p>
        </div>
        <button class="p-1 text-muted-foreground" aria-label="Закрыть" @click="selectedVehicleId = null">
          <X class="size-4" />
        </button>
      </div>
      <Button class="mt-3 w-full" :disabled="reportingDelay" @click="reportDelay">
        <LoaderCircle v-if="reportingDelay" class="mr-2 size-4 animate-spin" />
        <AlertTriangle v-else class="mr-2 size-4" />
        Автобус опаздывает
      </Button>
      <p v-if="delayMessage" class="mt-2 text-center text-xs text-muted-foreground">
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

    <AppDrawer v-model:open="drawerOpen" @open-support="supportOpen = true" />
    <SupportSheet v-model:open="supportOpen" />
  </main>
</template>
