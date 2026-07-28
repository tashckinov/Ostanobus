import { In, type DataSource } from 'typeorm'

import {
  Direction,
  DirectionStop,
  Route,
  Schedule,
  type GeoJsonLineString,
  type RouteSegment,
} from './entities.js'

function composeSegmentGeometry(segments: RouteSegment[]): GeoJsonLineString | null {
  if (!segments.length || segments.some((segment) => !segment.geometry)) return null
  const coordinates = segments.flatMap((segment, index) =>
    index === 0 ? segment.geometry!.coordinates : segment.geometry!.coordinates.slice(1),
  )
  return coordinates.length >= 2 ? { type: 'LineString', coordinates } : null
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
        const segments = direction.segments ?? []
        const expectedSegmentCount =
          direction.routeType === 'circular' ? stopIds.length : Math.max(0, stopIds.length - 1)
        const segmentsMatchStops =
          segments.length === expectedSegmentCount &&
          segments.every(
            (segment, index) =>
              segment.fromStopId === stopIds[index] &&
              segment.toStopId === stopIds[(index + 1) % stopIds.length],
          )
        const geometry = segments.length
          ? segmentsMatchStops
            ? composeSegmentGeometry(segments)
            : null
          : direction.geometry
        const distanceMeters = segments.length
          ? segments.every((segment) => segment.geometry && segment.distanceMeters !== null) &&
            segmentsMatchStops
            ? segments.reduce((total, segment) => total + (segment.distanceMeters ?? 0), 0)
            : null
          : direction.distanceMeters

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
                routingPoints: direction.routingPoints,
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
