import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

import type { DataSource } from 'typeorm'

import {
  Admin,
  City,
  Direction,
  DirectionStop,
  Forecast,
  Route,
  Stop,
  type GeoJsonLineString,
} from './entities.js'
import { hashPassword } from './security.js'

interface StopsData {
  features: Array<{
    properties: {
      id: string
      name: string
      shortName: string
      osmId?: number
      osmUrl?: string
    }
    geometry: { coordinates: [number, number] }
  }>
}

interface RoutesData {
  routes: Array<{
    routeId: string
    number: string
    color: string
    isMock?: boolean
    directions: Array<{
      id: string
      name: string
      terminal: string
      stopIds: string[]
      distanceMeters?: number
      path?: { format: 'polyline'; precision: number; value: string }
    }>
  }>
}

interface ForecastsData {
  generatedAt: string | null
  forecasts: Array<{
    stopId: string
    routeId: string
    minMinutes: number
    maxMinutes: number
    confidence: 'high' | 'medium' | 'low'
    sampleSize: number
  }>
}

function decodePolyline(value: string, precision: number): GeoJsonLineString {
  const coordinates: number[][] = []
  const factor = 10 ** precision
  let index = 0
  let latitude = 0
  let longitude = 0

  const decodeValue = () => {
    let result = 0
    let shift = 0
    let byte = 0
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
  return { type: 'LineString', coordinates }
}

async function readJson<T>(directory: string, filename: string) {
  return JSON.parse(await readFile(join(directory, filename), 'utf8')) as T
}

export async function seedDatabase(dataSource: DataSource, seedDirectory: string) {
  const cityRepository = dataSource.getRepository(City)
  const stopRepository = dataSource.getRepository(Stop)
  const routeRepository = dataSource.getRepository(Route)
  const directionRepository = dataSource.getRepository(Direction)
  const directionStopRepository = dataSource.getRepository(DirectionStop)
  const forecastRepository = dataSource.getRepository(Forecast)

  if (!(await cityRepository.exist({ where: { id: 'volgodonsk' } }))) {
    await cityRepository.save({
      id: 'volgodonsk',
      name: 'Волгодонск',
      centerLongitude: 42.216,
      centerLatitude: 47.531,
      active: true,
    })
  }

  if ((await stopRepository.count()) === 0) {
    const data = await readJson<StopsData>(seedDirectory, 'stops.geojson')
    await stopRepository.save(
      data.features.map((feature) => ({
        id: feature.properties.id,
        cityId: 'volgodonsk',
        name: feature.properties.name,
        shortName: feature.properties.shortName,
        longitude: feature.geometry.coordinates[0],
        latitude: feature.geometry.coordinates[1],
        osmId: feature.properties.osmId?.toString() ?? null,
        osmUrl: feature.properties.osmUrl ?? null,
        active: true,
      })),
      { chunk: 100 },
    )
  }

  if ((await routeRepository.count()) === 0) {
    const data = await readJson<RoutesData>(seedDirectory, 'route-stops.json')
    for (const routeData of data.routes) {
      await routeRepository.save({
        id: routeData.routeId,
        cityId: 'volgodonsk',
        number: routeData.number,
        name: null,
        color: routeData.color,
        active: true,
        isMock: Boolean(routeData.isMock),
      })
      for (const directionData of routeData.directions) {
        await directionRepository.save({
          id: directionData.id,
          routeId: routeData.routeId,
          name: directionData.name,
          terminal: directionData.terminal,
          geometry: directionData.path
            ? decodePolyline(directionData.path.value, directionData.path.precision)
            : null,
          routingPoints: directionData.stopIds.map((stopId) => ({
            type: 'stop' as const,
            stopId,
          })),
          distanceMeters: directionData.distanceMeters ?? null,
          active: true,
        })
        await directionStopRepository.save(
          directionData.stopIds.map((stopId, position) => ({
            directionId: directionData.id,
            stopId,
            position,
          })),
        )
      }
    }
  }

  if ((await forecastRepository.count()) === 0) {
    const data = await readJson<ForecastsData>(seedDirectory, 'mock-forecasts.json')
    const route = await routeRepository.findOneBy({ id: '3k' })
    const direction = await directionRepository.findOneBy({ routeId: route?.id ?? '3k' })
    await forecastRepository.save(
      data.forecasts.map((forecast) => ({
        id: randomUUID(),
        ...forecast,
        directionId: direction?.id ?? null,
        active: true,
        calculatedAt: new Date(data.generatedAt ?? Date.now()),
      })),
    )
  }

  const adminRepository = dataSource.getRepository(Admin)
  const email = (process.env.ADMIN_EMAIL ?? 'admin@ostanobus.local').toLowerCase()
  if (!(await adminRepository.exist({ where: { email } }))) {
    await adminRepository.save({
      id: randomUUID(),
      email,
      passwordHash: await hashPassword(process.env.ADMIN_PASSWORD ?? 'admin'),
      active: true,
    })
  }
}
