import type { ForecastsData, RouteStopsData, StopsCollection } from '@/types/transit'

async function fetchJson<T>(filename: string): Promise<T> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/${filename}`)
  if (!response.ok) {
    throw new Error(`Не удалось загрузить ${filename}: ${response.status}`)
  }
  return response.json() as Promise<T>
}

export async function loadTransitData() {
  const [stops, routeStops, forecasts] = await Promise.all([
    fetchJson<StopsCollection>('stops.geojson'),
    fetchJson<RouteStopsData>('route-stops.json'),
    fetchJson<ForecastsData>('mock-forecasts.json'),
  ])

  return { stops, routeStops, forecasts }
}
