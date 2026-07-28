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

function spikeCosine(previous: number[], point: number[], next: number[]) {
  const latitude = ((point[1] ?? 0) * Math.PI) / 180
  const scaleX = Math.cos(latitude)
  const leftX = ((previous[0] ?? 0) - (point[0] ?? 0)) * scaleX
  const leftY = (previous[1] ?? 0) - (point[1] ?? 0)
  const rightX = ((next[0] ?? 0) - (point[0] ?? 0)) * scaleX
  const rightY = (next[1] ?? 0) - (point[1] ?? 0)
  const leftLength = Math.hypot(leftX, leftY)
  const rightLength = Math.hypot(rightX, rightY)
  if (!leftLength || !rightLength) return -1
  return (leftX * rightX + leftY * rightY) / (leftLength * rightLength)
}

/**
 * Удаляет короткие возвратные ответвления геометрии. Они появляются, когда
 * роутер заводит линию к точке остановки вне дороги и затем возвращает её
 * обратно. Остановка остаётся отдельным маркером, а транспорт движется и
 * останавливается на ближайшей точке основной линии.
 */
export function sanitizeRouteCoordinates(
  coordinates: number[][],
  stopCoordinates: number[][],
): number[][] {
  if (coordinates.length < 3) return coordinates.map((point) => [...point])

  const result = coordinates.map((point) => [...point])
  let changed = true

  while (changed && result.length >= 3) {
    changed = false
    for (let index = 1; index < result.length - 1; index += 1) {
      const previous = result[index - 1]!
      const point = result[index]!
      const next = result[index + 1]!
      const directDistance = distanceMeters(previous, next)
      const viaDistance = distanceMeters(previous, point) + distanceMeters(point, next)
      const detour = viaDistance - directDistance
      const offsetFromRoad = pointToSegmentDistanceMeters(point, previous, next)
      const backtrack = spikeCosine(previous, point, next)
      const belongsToStop = stopCoordinates.some((stop) => distanceMeters(point, stop) <= 35)

      const isStopConnector = belongsToStop && detour >= 2 && offsetFromRoad >= 2
      const isReturnSpike = backtrack >= 0.35 && detour >= 3 && offsetFromRoad >= 2

      if (isStopConnector || isReturnSpike) {
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
