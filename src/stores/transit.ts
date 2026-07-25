import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { forecastsForStop } from '@/lib/forecast'
import { loadTransitData } from '@/lib/transit-data'
import type {
  HistoricalArrivalsData,
  RouteFeature,
  RoutesCollection,
  RouteStopsData,
  StopFeature,
  StopsCollection,
} from '@/types/transit'

const emptyStops: StopsCollection = {
  type: 'FeatureCollection',
  features: [],
}

const emptyRoutes: RoutesCollection = {
  type: 'FeatureCollection',
  features: [],
}

export const useTransitStore = defineStore('transit', () => {
  const stops = ref<StopsCollection>(emptyStops)
  const routes = ref<RoutesCollection>(emptyRoutes)
  const routeStops = ref<RouteStopsData>({ routes: [] })
  const historicalArrivals = ref<HistoricalArrivalsData>({
    generatedAt: null,
    forecasts: [],
  })
  const selectedStopId = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const selectedStop = computed<StopFeature | null>(
    () => stops.value.features.find((stop) => stop.properties.id === selectedStopId.value) ?? null,
  )

  const selectedStopForecasts = computed(() =>
    selectedStopId.value
      ? forecastsForStop(
          selectedStopId.value,
          historicalArrivals.value.forecasts,
          routeStops.value.routes,
        )
      : [],
  )

  const routeFeaturesById = computed(
    () =>
      new Map<string, RouteFeature>(
        routes.value.features.map((route) => [route.properties.id, route]),
      ),
  )

  const stopsById = computed(
    () =>
      new Map<string, StopFeature>(stops.value.features.map((stop) => [stop.properties.id, stop])),
  )

  async function initialise() {
    if (stops.value.features.length || loading.value) return

    loading.value = true
    error.value = null
    try {
      const data = await loadTransitData()
      stops.value = data.stops
      routes.value = data.routes
      routeStops.value = data.routeStops
      historicalArrivals.value = data.historicalArrivals
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : 'Не удалось загрузить данные'
    } finally {
      loading.value = false
    }
  }

  function selectStop(stopId: string | null) {
    selectedStopId.value = stopId
  }

  return {
    stops,
    routes,
    routeStops,
    selectedStopId,
    selectedStop,
    selectedStopForecasts,
    routeFeaturesById,
    stopsById,
    loading,
    error,
    initialise,
    selectStop,
  }
})
