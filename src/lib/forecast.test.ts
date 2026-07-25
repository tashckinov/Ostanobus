import { describe, expect, it } from 'vitest'

import { forecastsForStop, nextStopIndex } from './forecast'
import type { HistoricalForecast, TransitRoute } from '@/types/transit'

const routes: TransitRoute[] = [
  {
    routeId: '14',
    number: '14',
    color: '#e5aa22',
    directions: [],
  },
  {
    routeId: '18',
    number: '18',
    color: '#3d7e70',
    directions: [],
  },
]

const forecasts: HistoricalForecast[] = [
  {
    stopId: 'a',
    routeId: '18',
    minMinutes: 15,
    maxMinutes: 21,
    confidence: 'medium',
    sampleSize: 12,
  },
  {
    stopId: 'a',
    routeId: '14',
    minMinutes: 7,
    maxMinutes: 12,
    confidence: 'high',
    sampleSize: 34,
  },
  {
    stopId: 'b',
    routeId: '14',
    minMinutes: 2,
    maxMinutes: 4,
    confidence: 'high',
    sampleSize: 42,
  },
]

describe('forecastsForStop', () => {
  it('returns forecasts for the chosen stop ordered by expected arrival', () => {
    const result = forecastsForStop('a', forecasts, routes)

    expect(result.map((forecast) => forecast.routeId)).toEqual(['14', '18'])
    expect(result[0]?.route.number).toBe('14')
  })

  it('ignores forecasts for unknown routes', () => {
    const result = forecastsForStop(
      'a',
      [...forecasts, { ...forecasts[0]!, routeId: '99' }],
      routes,
    )

    expect(result).toHaveLength(2)
  })
})

describe('nextStopIndex', () => {
  it('advances until the trip is complete', () => {
    expect(nextStopIndex(0, 4)).toBe(1)
    expect(nextStopIndex(3, 4)).toBe(4)
    expect(nextStopIndex(4, 4)).toBe(4)
  })
})
