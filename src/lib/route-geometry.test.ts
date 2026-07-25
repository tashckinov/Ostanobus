import { describe, expect, it } from 'vitest'

import { buildRouteLines, decodePolyline } from './route-geometry'
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
