import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { checkApiHealth } from '@/lib/api'
import { forecastsForStop } from '@/lib/forecast'
import { loadForecastsForStop, loadTransitData } from '@/lib/transit-data'
import type { ForecastsData, RouteStopsData, StopFeature, StopsCollection } from '@/types/transit'

const emptyStops: StopsCollection = {
  type: 'FeatureCollection',
  features: [],
}

export const useTransitStore = defineStore('transit', () => {
  const stops = ref<StopsCollection>(emptyStops)
  const routeStops = ref<RouteStopsData>({ routes: [] })
  const forecasts = ref<ForecastsData>({
    generatedAt: null,
    isMock: true,
    forecasts: [],
  })
  const selectedStopId = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const apiOnline = ref(false)

  const selectedStop = computed<StopFeature | null>(
    () => stops.value.features.find((stop) => stop.properties.id === selectedStopId.value) ?? null,
  )

  const selectedStopForecasts = computed(() =>
    selectedStopId.value
      ? forecastsForStop(selectedStopId.value, forecasts.value.forecasts, routeStops.value.routes)
      : [],
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
      routeStops.value = data.routeStops
      forecasts.value = data.forecasts
      apiOnline.value = data.apiOnline
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : 'Не удалось загрузить данные'
    } finally {
      loading.value = false
    }
  }

  function selectStop(stopId: string | null) {
    selectedStopId.value = stopId
    if (stopId) void refreshForecasts(stopId)
  }

  async function refreshForecasts(stopId: string) {
    const loaded = await loadForecastsForStop(stopId)
    if (!loaded) return
    forecasts.value = {
      generatedAt: loaded.generatedAt,
      isMock: false,
      forecasts: [
        ...forecasts.value.forecasts.filter((forecast) => forecast.stopId !== stopId),
        ...loaded.forecasts,
      ],
    }
  }

  async function refreshApiHealth() {
    apiOnline.value = await checkApiHealth()
    return apiOnline.value
  }

  return {
    stops,
    routeStops,
    selectedStopId,
    selectedStop,
    selectedStopForecasts,
    stopsById,
    loading,
    error,
    apiOnline,
    initialise,
    refreshApiHealth,
    selectStop,
  }
})
