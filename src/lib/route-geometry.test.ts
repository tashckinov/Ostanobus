import { describe, expect, it } from 'vitest'

import { buildRouteLines } from './route-geometry'
import type { StopFeature, TransitRoute } from '@/types/transit'

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
})
