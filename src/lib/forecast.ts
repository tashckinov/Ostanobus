import type { HistoricalForecast, StopForecast, TransitRoute } from '@/types/transit'

export function forecastsForStop(
  stopId: string,
  forecasts: HistoricalForecast[],
  routes: TransitRoute[],
): StopForecast[] {
  const routeById = new Map(routes.map((route) => [route.routeId, route]))

  return forecasts
    .filter((forecast) => forecast.stopId === stopId)
    .map((forecast) => {
      const route = routeById.get(forecast.routeId)
      if (!route) return null
      return { ...forecast, route }
    })
    .filter((forecast): forecast is StopForecast => forecast !== null)
    .sort((a, b) => (a.minMinutes + a.maxMinutes) / 2 - (b.minMinutes + b.maxMinutes) / 2)
}

export function confidenceLabel(confidence: StopForecast['confidence']) {
  const labels = {
    high: 'Высокая вероятность',
    medium: 'Средняя вероятность',
    low: 'Мало данных',
  }

  return labels[confidence]
}

export function nextStopIndex(currentIndex: number, stopCount: number) {
  if (stopCount <= 0) return 0
  return Math.min(currentIndex + 1, stopCount)
}
