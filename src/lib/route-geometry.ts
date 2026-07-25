import type { FeatureCollection, LineString } from 'geojson'

import type { StopFeature, TransitRoute } from '@/types/transit'

interface RouteLineProperties {
  routeId: string
  directionId: string
  number: string
  color: string
  isMock: boolean
}

export function buildRouteLines(
  routes: TransitRoute[],
  stopsById: Map<string, StopFeature>,
): FeatureCollection<LineString, RouteLineProperties> {
  return {
    type: 'FeatureCollection',
    features: routes.flatMap((route) =>
      route.directions.flatMap((direction) => {
        const coordinates = direction.stopIds
          .map((stopId) => stopsById.get(stopId)?.geometry.coordinates)
          .filter((coordinate): coordinate is number[] => Boolean(coordinate))

        if (coordinates.length < 2) return []

        return [
          {
            type: 'Feature' as const,
            properties: {
              routeId: route.routeId,
              directionId: direction.id,
              number: route.number,
              color: route.color,
              isMock: Boolean(route.isMock),
            },
            geometry: {
              type: 'LineString' as const,
              coordinates,
            },
          },
        ]
      }),
    ),
  }
}
