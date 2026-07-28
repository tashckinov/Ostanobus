import { describe, expect, it } from 'vitest'

import { buildRouteLines, decodePolyline, sanitizeRouteCoordinates } from './route-geometry'
import type { StopFeature, TransitRoute } from '@/types/transit'

describe('decodePolyline', () => {
  it('decodes an offline road path to longitude and latitude pairs', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ])
  })
})

describe('sanitizeRouteCoordinates', () => {
  it('удаляет резкий заезд к точке остановки и возврат на дорогу', () => {
    const roadBefore = [42.2, 47.5]
    const stop = [42.20025, 47.5001]
    const roadAfter = [42.2, 47.5002]

    expect(sanitizeRouteCoordinates([roadBefore, stop, roadAfter], [stop])).toEqual([
      roadBefore,
      roadAfter,
    ])
  })

  it('оставляет остановку, которая действительно лежит на линии маршрута', () => {
    const before = [42.2, 47.5]
    const stop = [42.2, 47.5001]
    const after = [42.2, 47.5002]

    expect(sanitizeRouteCoordinates([before, stop, after], [stop])).toEqual([
      before,
      stop,
      after,
    ])
  })
})

describe('buildRouteLines', () => {
  it('connects route stops in declared order', () => {
    const stops = new Map<string, StopFeature>([
      [
        'a',
        {
          type: 'Feature',
          properties: { id: 'a', name: 'A', shortName: 'A' },
          geometry: { type: 'Point', coordinates: [42.1, 47.5] },
        },
      ],
      [
        'b',
        {
          type: 'Feature',
          properties: { id: 'b', name: 'B', shortName: 'B' },
          geometry: { type: 'Point', coordinates: [42.2, 47.6] },
        },
      ],
    ])
    const routes: TransitRoute[] = [
      {
        routeId: '3k',
        number: '3К',
        color: '#0074dc',
        isMock: true,
        directions: [{ id: 'forward', name: 'forward', terminal: 'B', stopIds: ['a', 'b'] }],
      },
    ]

    const result = buildRouteLines(routes, stops)

    expect(result.features[0]?.geometry.coordinates).toEqual([
      [42.1, 47.5],
      [42.2, 47.6],
    ])
  })

  it('prefers the stored road path over straight stop segments', () => {
    const stops = new Map<string, StopFeature>()
    const routes: TransitRoute[] = [
      {
        routeId: '3k',
        number: '3К',
        color: '#0074dc',
        isMock: true,
        directions: [
          {
            id: 'forward',
            name: 'forward',
            terminal: 'B',
            stopIds: [],
            path: {
              format: 'polyline',
              precision: 5,
              value: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
            },
          },
        ],
      },
    ]

    const result = buildRouteLines(routes, stops)

    expect(result.features[0]?.geometry.coordinates).toHaveLength(3)
  })
})
