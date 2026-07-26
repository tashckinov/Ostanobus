import { In, type DataSource } from 'typeorm'

import { Direction, DirectionStop, Route, Schedule } from './entities.js'

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
      .map((direction) => ({
        id: direction.id,
        name: direction.name,
        terminal: direction.terminal,
        stopIds: directionStops
          .filter((item) => item.directionId === direction.id)
          .map((item) => item.stopId),
        geometry: direction.geometry,
        distanceMeters: direction.distanceMeters,
        active: direction.active,
        ...(includeEditorData ? { routingPoints: direction.routingPoints } : {}),
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
      })),
  }))
}
