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

function distanceMeters(left: number[], right: number[]) {
  const latitude = (((left[1] ?? 0) + (right[1] ?? 0)) / 2) * (Math.PI / 180)
  const latitudeDelta = ((right[1] ?? 0) - (left[1] ?? 0)) * (Math.PI / 180)
  const longitudeDelta = ((right[0] ?? 0) - (left[0] ?? 0)) * (Math.PI / 180)
  return 6_371_000 * Math.hypot(latitudeDelta, Math.cos(latitude) * longitudeDelta)
}

function pointToSegmentDistanceMeters(point: number[], start: number[], end: number[]) {
  const latitude = (((start[1] ?? 0) + (end[1] ?? 0)) / 2) * (Math.PI / 180)
  const scaleX = Math.cos(latitude)
  const px = (point[0] ?? 0) * scaleX
  const py = point[1] ?? 0
  const ax = (start[0] ?? 0) * scaleX
  const ay = start[1] ?? 0
  const bx = (end[0] ?? 0) * scaleX
  const by = end[1] ?? 0
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  const progress = lengthSquared
    ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared))
    : 0
  const projected = [(ax + progress * dx) / scaleX, ay + progress * dy]
  return distanceMeters(point, projected)
}

/**
 * Удаляет короткие ответвления, которые возникают, когда геометрия дороги
 * искусственно заводится к географической точке остановки и сразу возвращается
 * обратно. Остановка при этом остаётся на карте, а транспорт останавливается в
 * ближайшей точке основной линии маршрута.
 */
export function sanitizeRouteCoordinates(
  coordinates: number[][],
  stopCoordinates: number[][],
): number[][] {
  if (coordinates.length < 3 || !stopCoordinates.length) return coordinates.map((point) => [...point])

  const result = coordinates.map((point) => [...point])
  let changed = true

  while (changed && result.length >= 3) {
    changed = false
    for (let index = 1; index < result.length - 1; index += 1) {
      const previous = result[index - 1]!
      const point = result[index]!
      const next = result[index + 1]!
      const belongsToStop = stopCoordinates.some((stop) => distanceMeters(point, stop) <= 12)
      if (!belongsToStop) continue

      const directDistance = distanceMeters(previous, next)
      const viaDistance = distanceMeters(previous, point) + distanceMeters(point, next)
      const offsetFromRoad = pointToSegmentDistanceMeters(point, previous, next)

      if (viaDistance - directDistance >= 8 && offsetFromRoad >= 5) {
        result.splice(index, 1)
        changed = true
        break
      }
    }
  }

  return result
}

export function directionRouteCoordinates(
  direction: TransitRoute['directions'][number],
  stopsById: Map<string, StopFeature>,
) {
  const stopCoordinates = direction.stopIds
    .map((stopId) => stopsById.get(stopId)?.geometry.coordinates)
    .filter((coordinate): coordinate is number[] => Boolean(coordinate))

  const rawCoordinates = direction.geometry
    ? direction.geometry.coordinates
    : direction.path
      ? decodePolyline(direction.path.value, direction.path.precision)
      : stopCoordinates

  return sanitizeRouteCoordinates(rawCoordinates, stopCoordinates)
}

export function buildRouteLines(
  routes: TransitRoute[],
  stopsById: Map<string, StopFeature>,
): FeatureCollection<LineString, RouteLineProperties> {
  return {
    type: 'FeatureCollection',
    features: routes.flatMap((route) =>
      route.directions.flatMap((direction) => {
        const coordinates = directionRouteCoordinates(direction, stopsById)
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
