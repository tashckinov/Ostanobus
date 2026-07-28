import { In, type DataSource } from 'typeorm'

import {
  Direction,
  DirectionStop,
  Route,
  Schedule,
  Stop,
  type GeoJsonLineString,
  type LegacyRouteSegment,
  type LegacyRoutingPoint,
  type RoadAnchor,
  type RouteSegment,
} from './entities.js'

function composeSegmentGeometry(segments: RouteSegment[]): GeoJsonLineString | null {
  if (!segments.length || segments.some((segment) => !segment.geometry)) return null
  const coordinates = segments.flatMap((segment, index) =>
    index === 0 ? segment.geometry!.coordinates : segment.geometry!.coordinates.slice(1),
  )
  return coordinates.length >= 2 ? { type: 'LineString', coordinates } : null
}

function segmentId(directionId: string, fromStopId: string, toStopId: string, index: number) {
  return `segment-${directionId}-${index}-${fromStopId}-${toStopId}`
}

function expectedPairs(stopIds: string[], routeType: Direction['routeType']) {
  const pairs = stopIds
    .slice(0, -1)
    .map((fromStopId, index) => [fromStopId, stopIds[index + 1]!] as const)
  if (routeType === 'circular' && stopIds.length > 1) {
    pairs.push([stopIds.at(-1)!, stopIds[0]!] as const)
  }
  return pairs
}

function normalizeRoadAnchors(
  stored: Array<RoadAnchor | LegacyRoutingPoint>,
  stopIds: string[],
): RoadAnchor[] {
  const allowedStops = new Set(stopIds)
  const anchors = new Map<string, RoadAnchor>()
  for (const point of stored ?? []) {
    if (
      'stopId' in point &&
      allowedStops.has(point.stopId) &&
      point.longitude !== undefined &&
      point.latitude !== undefined &&
      Number.isFinite(point.longitude) &&
      Number.isFinite(point.latitude)
    ) {
      anchors.set(point.stopId, {
        stopId: point.stopId,
        longitude: point.longitude,
        latitude: point.latitude,
      })
    }
  }
  return [...anchors.values()]
}

function normalizeSegment(
  directionId: string,
  segment: RouteSegment | LegacyRouteSegment,
  index: number,
): RouteSegment {
  const legacyStatus = segment.status
  const mode =
    segment.mode === 'automatic' || segment.mode === 'manual'
      ? segment.mode
      : legacyStatus === 'manual'
        ? 'manual'
        : 'automatic'
  const status =
    legacyStatus === 'fixed' || legacyStatus === 'verified'
      ? 'fixed'
      : legacyStatus === 'error'
        ? 'error'
        : 'draft'
  return {
    id:
      'id' in segment && segment.id
        ? segment.id
        : segmentId(directionId, segment.fromStopId, segment.toStopId, index),
    fromStopId: segment.fromStopId,
    toStopId: segment.toStopId,
    mode,
    status,
    viaPoints: segment.viaPoints ?? [],
    geometry: segment.geometry ?? null,
    distanceMeters: segment.distanceMeters ?? null,
  }
}

function coordinateDistance(left: number[], right: number[]) {
  const longitude = (left[0] ?? 0) - (right[0] ?? 0)
  const latitude = (left[1] ?? 0) - (right[1] ?? 0)
  return longitude * longitude + latitude * latitude
}

function lineDistance(coordinates: number[][]) {
  const radians = (value: number) => (value * Math.PI) / 180
  let total = 0
  for (let index = 1; index < coordinates.length; index += 1) {
    const left = coordinates[index - 1]!
    const right = coordinates[index]!
    const latitudeDelta = radians((right[1] ?? 0) - (left[1] ?? 0))
    const longitudeDelta = radians((right[0] ?? 0) - (left[0] ?? 0))
    const latitude = radians(((left[1] ?? 0) + (right[1] ?? 0)) / 2)
    total += 6_371_000 * Math.sqrt(latitudeDelta ** 2 + (Math.cos(latitude) * longitudeDelta) ** 2)
  }
  return Math.round(total)
}

function deduplicateCoordinates(coordinates: number[][]) {
  return coordinates.filter(
    (coordinate, index) =>
      index === 0 ||
      coordinate[0] !== coordinates[index - 1]?.[0] ||
      coordinate[1] !== coordinates[index - 1]?.[1],
  )
}

function migrateLegacyGeometry(
  direction: Direction,
  stopIds: string[],
  roadAnchors: RoadAnchor[],
  stopsById: Map<string, Stop>,
): RouteSegment[] {
  const pairs = expectedPairs(stopIds, direction.routeType ?? 'linear')
  const path = direction.geometry?.coordinates ?? []
  const anchorsByStop = new Map(roadAnchors.map((anchor) => [anchor.stopId, anchor]))
  const endpoints = stopIds.map((stopId) => {
    const anchor = anchorsByStop.get(stopId)
    const stop = stopsById.get(stopId)
    return anchor
      ? [anchor.longitude, anchor.latitude]
      : stop
        ? [stop.longitude, stop.latitude]
        : null
  })

  if (path.length < 2 || endpoints.some((coordinate) => !coordinate)) {
    return pairs.map(([fromStopId, toStopId], index) => ({
      id: segmentId(direction.id, fromStopId, toStopId, index),
      fromStopId,
      toStopId,
      mode: 'automatic',
      status: 'error',
      viaPoints: [],
      geometry: null,
      distanceMeters: null,
    }))
  }

  const pathIndexes: number[] = []
  let minimumIndex = 0
  for (const endpoint of endpoints) {
    let nearestIndex = minimumIndex
    let nearestDistance = Number.POSITIVE_INFINITY
    for (let index = minimumIndex; index < path.length; index += 1) {
      const distance = coordinateDistance(path[index]!, endpoint!)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearestIndex = index
      }
    }
    pathIndexes.push(nearestIndex)
    minimumIndex = nearestIndex
  }

  return pairs.map(([fromStopId, toStopId], index) => {
    const from = endpoints[index]!
    const to = endpoints[(index + 1) % endpoints.length]!
    const fromIndex = pathIndexes[index]!
    const toIndex = pathIndexes[(index + 1) % pathIndexes.length]!
    const pathSlice =
      index === stopIds.length - 1 && direction.routeType === 'circular'
        ? [...path.slice(fromIndex), ...path.slice(0, toIndex + 1)]
        : path.slice(fromIndex, Math.max(fromIndex, toIndex) + 1)
    const coordinates = deduplicateCoordinates([from, ...pathSlice, to])
    return {
      id: segmentId(direction.id, fromStopId, toStopId, index),
      fromStopId,
      toStopId,
      mode: 'automatic' as const,
      status: 'draft' as const,
      viaPoints: [],
      geometry: { type: 'LineString' as const, coordinates },
      distanceMeters: lineDistance(coordinates),
    }
  })
}

function buildCanonicalSegments(
  direction: Direction,
  stopIds: string[],
  roadAnchors: RoadAnchor[],
  stopsById: Map<string, Stop>,
): RouteSegment[] {
  const pairs = expectedPairs(stopIds, direction.routeType ?? 'linear')
  const storedSegments = (direction.segments ?? []).map((segment, index) =>
    normalizeSegment(direction.id, segment, index),
  )
  if (!storedSegments.length) {
    return migrateLegacyGeometry(direction, stopIds, roadAnchors, stopsById)
  }
  const byPair = new Map(
    storedSegments.map((segment) => [`${segment.fromStopId}\u0000${segment.toStopId}`, segment]),
  )
  return pairs.map(([fromStopId, toStopId], index) => {
    const existing = byPair.get(`${fromStopId}\u0000${toStopId}`)
    return (
      existing ?? {
        id: segmentId(direction.id, fromStopId, toStopId, index),
        fromStopId,
        toStopId,
        mode: 'automatic' as const,
        status: 'error' as const,
        viaPoints: [],
        geometry: null,
        distanceMeters: null,
      }
    )
  })
}

export async function readRoutes(
  dataSource: DataSource,
  cityId?: string,
  activeOnly = true,
  includeEditorData = false,
) {
  const routeRepository = dataSource.getRepository(Route)
  const directionRepository = dataSource.getRepository(Direction)
  const directionStopRepository = dataSource.getRepository(DirectionStop)
  const scheduleRepository = dataSource.getRepository(Schedule)
  const stopRepository = dataSource.getRepository(Stop)

  const routes = await routeRepository.find({
    where: {
      ...(cityId ? { cityId } : {}),
      ...(activeOnly ? { active: true } : {}),
    },
    order: { number: 'ASC' },
  })
  const routeIds = routes.map((route) => route.id)
  if (!routeIds.length) return []

  const directions = await directionRepository.find({
    where: {
      routeId: In(routeIds),
      ...(activeOnly ? { active: true } : {}),
    },
    order: { id: 'ASC' },
  })
  const directionIds = directions.map((direction) => direction.id)
  const directionStops = directionIds.length
    ? await directionStopRepository.find({
        where: { directionId: In(directionIds) },
        order: { directionId: 'ASC', position: 'ASC' },
      })
    : []
  const usedStopIds = [...new Set(directionStops.map((item) => item.stopId))]
  const stops = usedStopIds.length ? await stopRepository.findBy({ id: In(usedStopIds) }) : []
  const stopsById = new Map(stops.map((stop) => [stop.id, stop]))
  const schedules = directionIds.length
    ? await scheduleRepository.find({
        where: {
          directionId: In(directionIds),
          ...(activeOnly ? { active: true } : {}),
        },
        order: { directionId: 'ASC', departureTime: 'ASC', startTime: 'ASC' },
      })
    : []

  return routes.map((route) => ({
    routeId: route.id,
    cityId: route.cityId,
    number: route.number,
    name: route.name,
    color: route.color,
    active: route.active,
    isMock: route.isMock,
    directions: directions
      .filter((direction) => direction.routeId === route.id)
      .map((direction) => {
        const stopIds = directionStops
          .filter((item) => item.directionId === direction.id)
          .map((item) => item.stopId)
        const roadAnchors = normalizeRoadAnchors(direction.roadAnchors ?? [], stopIds)
        const segments = buildCanonicalSegments(direction, stopIds, roadAnchors, stopsById)
        const geometry = composeSegmentGeometry(segments)
        const distanceMeters = segments.every(
          (segment) => segment.geometry && segment.distanceMeters !== null,
        )
          ? segments.reduce((total, segment) => total + (segment.distanceMeters ?? 0), 0)
          : null

        return {
          id: direction.id,
          name: direction.name,
          terminal: direction.terminal,
          stopIds,
          geometry,
          distanceMeters,
          active: direction.active,
          ...(includeEditorData
            ? {
                routeType: direction.routeType ?? 'linear',
                roadAnchors,
                segments,
              }
            : {}),
          schedules: schedules
            .filter((schedule) => schedule.directionId === direction.id)
            .map((schedule) => ({
              id: schedule.id,
              stopId: schedule.stopId,
              days: schedule.days,
              type: schedule.type,
              departureTime: schedule.departureTime,
              startTime: schedule.startTime,
              endTime: schedule.endTime,
              headwayMinutes: schedule.headwayMinutes,
              active: schedule.active,
            })),
        }
      }),
  }))
}
