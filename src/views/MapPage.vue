<script setup lang="ts">
import { BusFront, CircleHelp, Layers3, LoaderCircle, Navigation, Radio } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'

import ActiveRideCard from '@/components/ActiveRideCard.vue'
import MapCanvas from '@/components/MapCanvas.vue'
import RideSetupDialog from '@/components/RideSetupDialog.vue'
import StopPanel from '@/components/StopPanel.vue'
import Badge from '@/components/ui/badge/Badge.vue'
import Button from '@/components/ui/button/Button.vue'
import { useRideStore } from '@/stores/ride'
import { useTransitStore } from '@/stores/transit'
import type { RouteDirection, TransitRoute } from '@/types/transit'

const transit = useTransitStore()
const ride = useRideStore()
const rideSetupOpen = ref(false)
const suggestedRouteId = ref<string>()

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

onMounted(async () => {
  await Promise.all([transit.initialise(), ride.refreshPendingCount()])
})

function openRideSetup(routeId?: string) {
  suggestedRouteId.value = routeId
  rideSetupOpen.value = true
}

function startRide(route: TransitRoute, direction: RouteDirection) {
  ride.startRide(route, direction)
  transit.selectStop(null)
  rideSetupOpen.value = false
}

async function markNextStop() {
  if (!activeDirection.value) return
  await ride.markNextStop(activeDirection.value)
}
</script>

<template>
  <div class="relative h-full w-full bg-muted">
    <MapCanvas v-if="transit.stops.features.length" />

    <header
      class="safe-top pointer-events-none fixed inset-x-0 top-0 z-20 flex items-center justify-between px-3 md:px-4"
    >
      <div
        class="pointer-events-auto flex items-center gap-2 rounded-2xl border border-white/70 bg-card/92 p-2 pr-3 shadow-float backdrop-blur-xl"
      >
        <span class="flex size-10 items-center justify-center rounded-xl bg-primary text-secondary">
          <BusFront class="size-5" />
        </span>
        <div>
          <h1 class="text-sm font-black leading-none tracking-tight">Останобус</h1>
          <p class="mt-1 text-[10px] leading-none text-muted-foreground">Волгодонск · прототип</p>
        </div>
      </div>

      <div class="pointer-events-auto flex items-center gap-2">
        <Badge v-if="ride.pendingCount > 0" class="hidden shadow sm:inline-flex">
          <Radio class="mr-1.5 size-3.5 text-amber-600" />
          {{ ride.pendingCount }} в очереди
        </Badge>
        <RouterLink
          to="/about"
          class="flex size-11 items-center justify-center rounded-xl border border-white/70 bg-card/92 shadow-float backdrop-blur-xl"
          aria-label="О приложении"
        >
          <CircleHelp class="size-5" />
        </RouterLink>
      </div>
    </header>

    <div
      v-if="transit.loading"
      class="absolute inset-0 z-10 flex items-center justify-center bg-background"
    >
      <div class="text-center text-sm text-muted-foreground">
        <LoaderCircle class="mx-auto mb-3 size-7 animate-spin text-primary" />
        Загружаем маршруты
      </div>
    </div>

    <div
      v-else-if="transit.error"
      class="absolute left-1/2 top-1/2 z-10 w-[min(90%,360px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-card p-5 text-center shadow-float"
    >
      <p class="font-bold">Карта не загрузилась</p>
      <p class="mt-2 text-sm text-muted-foreground">{{ transit.error }}</p>
      <Button class="mt-4" @click="transit.initialise()">Повторить</Button>
    </div>

    <div
      v-if="!transit.selectedStop && !ride.isActive && !transit.loading"
      class="pointer-events-none fixed inset-x-0 bottom-5 z-10 flex justify-center px-4"
    >
      <div
        class="pointer-events-auto flex max-w-sm items-center gap-3 rounded-2xl border border-white/70 bg-card/94 p-3 pr-5 shadow-float backdrop-blur-xl"
      >
        <span class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary/55">
          <Navigation class="size-5 text-primary" />
        </span>
        <div>
          <p class="text-sm font-bold">Выберите остановку</p>
          <p class="mt-0.5 text-xs text-muted-foreground">
            Нажмите на любую точку, чтобы увидеть прогноз
          </p>
        </div>
      </div>
    </div>

    <div
      class="pointer-events-none fixed left-3 top-[max(5.3rem,env(safe-area-inset-top))] z-10 md:left-4"
    >
      <Badge class="pointer-events-auto shadow">
        <Layers3 class="mr-1.5 size-3.5" />
        2 маршрута · 7 остановок
      </Badge>
    </div>

    <StopPanel
      v-if="transit.selectedStop && !ride.isActive"
      :stop="transit.selectedStop"
      :forecasts="transit.selectedStopForecasts"
      @close="transit.selectStop(null)"
      @start-ride="openRideSetup"
    />

    <ActiveRideCard
      v-if="ride.activeRide && activeRoute && activeDirection"
      :ride="ride.activeRide"
      :route="activeRoute"
      :direction="activeDirection"
      :stops-by-id="transit.stopsById"
      :pending-count="ride.pendingCount"
      :just-saved-stop-id="ride.justSavedStopId"
      @mark="markNextStop"
      @finish="ride.finishRide"
    />

    <RideSetupDialog
      v-model:open="rideSetupOpen"
      :routes="transit.routeStops.routes"
      :suggested-route-id="suggestedRouteId"
      @start="startRide"
    />
  </div>
</template>
