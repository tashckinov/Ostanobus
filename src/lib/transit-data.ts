import type { ForecastsData, RouteStopsData, StopsCollection } from '@/types/transit'
import { apiIsConfigured, apiUrl, checkApiHealth } from '@/lib/api'

async function fetchJson<T>(filename: string): Promise<T> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/${filename}`)
  if (!response.ok) {
    throw new Error(`Не удалось загрузить ${filename}: ${response.status}`)
  }
  return response.json() as Promise<T>
}

export async function loadTransitData() {
  const [localStops, localRouteStops, forecasts] = await Promise.all([
    fetchJson<StopsCollection>('stops.geojson'),
    fetchJson<RouteStopsData>('route-stops.json'),
    fetchJson<ForecastsData>('mock-forecasts.json'),
  ])

  if (!apiIsConfigured() || !navigator.onLine) {
    return {
      stops: localStops,
      routeStops: localRouteStops,
      forecasts,
      apiOnline: false,
      serverVersion: undefined,
    }
  }

  try {
    const health = await checkApiHealth()
    if (!health.online) {
      return {
        stops: localStops,
        routeStops: localRouteStops,
        forecasts,
        apiOnline: false,
        serverVersion: health.version,
      }
    }

    const [stopsResponse, routesResponse] = await Promise.all([
      fetch(apiUrl('/api/v1/stops')),
      fetch(apiUrl('/api/v1/routes')),
    ])
    if (!stopsResponse.ok || !routesResponse.ok) throw new Error('Backend unavailable')
    return {
      stops: (await stopsResponse.json()) as StopsCollection,
      routeStops: (await routesResponse.json()) as RouteStopsData,
      forecasts: {
        generatedAt: null,
        isMock: false,
        forecasts: [],
      } satisfies ForecastsData,
      apiOnline: true,
      serverVersion: health.version,
    }
  } catch {
    return {
      stops: localStops,
      routeStops: localRouteStops,
      forecasts,
      apiOnline: false,
      serverVersion: undefined,
    }
  }
}

export async function loadForecastsForStop(stopId: string) {
  if (!apiIsConfigured() || !navigator.onLine) return null
  try {
    const response = await fetch(apiUrl(`/api/v1/stops/${encodeURIComponent(stopId)}/forecasts`))
    if (!response.ok) return null
    return (await response.json()) as Omit<ForecastsData, 'isMock'>
  } catch {
    return null
  }
}
