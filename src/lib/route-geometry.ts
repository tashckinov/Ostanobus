import type { FeatureCollection, LineString } from 'geojson'

import type { StopFeature, TransitRoute } from '@/types/transit'

interface RouteLineProperties {
  routeId: string
  directionId: string
  number: string
  color: string
  isMock: boolean
}

export function decodePolyline(value: string, precision = 5): number[][] {
  const coordinates: number[][] = []
  const factor = 10 ** precision
  let index = 0
  let latitude = 0
  let longitude = 0

  function decodeValue() {
    let result = 0
    let shift = 0
    let byte: number

    do {
      byte = value.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20 && index < value.length)

    return result & 1 ? ~(result >> 1) : result >> 1
  }

  while (index < value.length) {
    latitude += decodeValue()
    longitude += decodeValue()
    coordinates.push([longitude / factor, latitude / factor])
  }

  return coordinates
}

export function buildRouteLines(
  routes: TransitRoute[],
  stopsById: Map<string, StopFeature>,
): FeatureCollection<LineString, RouteLineProperties> {
  return {
    type: 'FeatureCollection',
    features: routes.flatMap((route) =>
      route.directions.flatMap((direction) => {
        const coordinates = direction.path
          ? decodePolyline(direction.path.value, direction.path.precision)
          : direction.stopIds
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
