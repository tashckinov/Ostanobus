import { randomUUID } from 'node:crypto'

import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import { In, Like, type DataSource } from 'typeorm'
import { z } from 'zod'

import {
  Admin,
  City,
  Direction,
  DirectionStop,
  Forecast,
  Route,
  Schedule,
  Stop,
  SupportTicket,
  TransitEvent,
} from './entities.js'
import { readRoutes } from './route-service.js'
import { createPublicToken, hashPublicToken, verifyPassword } from './security.js'

const id = z.string().trim().min(1).max(160)
const nullableId = id.nullable().optional()
const coordinate = z.number().finite()
const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .nullable()
  .optional()

const stopSchema = z.object({
  id: id.optional(),
  cityId: id,
  name: z.string().trim().min(1).max(200),
  shortName: z.string().trim().min(1).max(200),
  longitude: coordinate.min(-180).max(180),
  latitude: coordinate.min(-90).max(90),
  osmId: z.string().trim().max(80).nullable().optional(),
  osmUrl: z.url().nullable().optional(),
  active: z.boolean().default(true),
})

const routingPointSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('stop'),
    stopId: id,
    longitude: coordinate.min(-180).max(180).optional(),
    latitude: coordinate.min(-90).max(90).optional(),
  }),
  z.object({
    type: z.literal('anchor'),
    longitude: coordinate.min(-180).max(180),
    latitude: coordinate.min(-90).max(90),
  }),
])

const lineStringSchema = z
  .object({
    type: z.literal('LineString'),
    coordinates: z.array(z.tuple([coordinate, coordinate])).min(2),
  })
  .nullable()
  .optional()

const segmentSchema = z.object({
  fromStopId: id,
  toStopId: id,
  status: z.enum(['auto', 'manual', 'verified', 'error']),
  viaPoints: z.array(
    z.object({
      longitude: coordinate.min(-180).max(180),
      latitude: coordinate.min(-90).max(90),
    })
  ),
  geometry: lineStringSchema,
  distanceMeters: z.number().int().nonnegative().nullable().optional(),
})

const directionSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(200),
    terminal: z.string().trim().min(1).max(200),
    routeType: z.enum(['linear', 'circular']).default('linear'),
    stopIds: z.array(id).min(2),
    routingPoints: z.array(routingPointSchema).min(2),
    segments: z.array(segmentSchema).default([]),
    geometry: lineStringSchema,
    distanceMeters: z.number().int().nonnegative().nullable().optional(),
    active: z.boolean().default(true),
  })
  .superRefine((value, context) => {
    value.routingPoints.forEach((point, index) => {
      if (
        point.type === 'stop' &&
        (point.longitude === undefined) !== (point.latitude === undefined)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['routingPoints', index],
          message: 'longitude and latitude must be provided together',
        })
      }
    })
  })

const routeSchema = z.object({
  routeId: id,
  cityId: id,
  number: z.string().trim().min(1).max(30),
  name: z.string().trim().max(200).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  active: z.boolean().default(true),
  isMock: z.boolean().default(false),
  directions: z.array(directionSchema).min(1),
})

const scheduleSchema = z
  .object({
    id: id.optional(),
    directionId: id,
    stopId: nullableId,
    days: z.array(z.number().int().min(1).max(7)).min(1),
    type: z.enum(['exact', 'interval']),
    departureTime: time,
    startTime: time,
    endTime: time,
    headwayMinutes: z.number().int().min(1).max(360).nullable().optional(),
    active: z.boolean().default(true),
  })
  .superRefine((value, context) => {
    if (value.type === 'exact' && !value.departureTime) {
      context.addIssue({ code: 'custom', message: 'departureTime is required' })
    }
    if (
      value.type === 'interval' &&
      (!value.startTime || !value.endTime || !value.headwayMinutes)
    ) {
      context.addIssue({ code: 'custom', message: 'interval fields are required' })
    }
  })

const forecastSchema = z.object({
  id: id.optional(),
  stopId: id,
  routeId: id,
  directionId: nullableId,
  minMinutes: z.number().int().nonnegative(),
  maxMinutes: z.number().int().nonnegative(),
  confidence: z.enum(['high', 'medium', 'low']),
  sampleSize: z.number().int().nonnegative().default(0),
  active: z.boolean().default(true),
})

const syncSchema = z.object({
  clientId: id,
  events: z
    .array(
      z.object({
        id,
        type: z.enum(['bus_arrival', 'stop_passage']),
        routeId: id,
        directionId: nullableId,
        stopId: id,
        occurredAt: z.iso.datetime(),
      }),
    )
    .min(1)
    .max(100),
})

const ticketSchema = z.object({
  clientId: id,
  category: z.enum(['stop', 'route', 'schedule', 'forecast', 'other']),
  message: z.string().trim().min(3).max(4000),
  stopId: nullableId,
  routeId: nullableId,
})

function validationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({
    error: 'validation_error',
    details: z.treeifyError(error),
  })
}

function toGeoJson(stops: Stop[]) {
  return {
    type: 'FeatureCollection',
    features: stops.map((stop) => ({
      type: 'Feature',
      properties: {
        id: stop.id,
        cityId: stop.cityId,
        name: stop.name,
        shortName: stop.shortName,
        osmId: stop.osmId,
        osmUrl: stop.osmUrl,
        active: stop.active,
      },
      geometry: {
        type: 'Point',
        coordinates: [stop.longitude, stop.latitude],
      },
    })),
  }
}

export interface CreateAppOptions {
  dataSource: DataSource
  logger?: boolean
}

export async function createApp({ dataSource, logger = true }: CreateAppOptions) {
  const app = Fastify({ logger })
  const corsOrigins = (
    process.env.CORS_ORIGINS ??
    'http://localhost:5173,http://localhost:8080,https://tashckinov.github.io'
  )
    .split(',')
    .map((origin) => origin.trim())

  await app.register(cors, {
    origin: (origin, callback) => {
      callback(null, !origin || corsOrigins.includes(origin))
    },
  })
  await app.register(jwt, {
    secret: process.env.JWT_SECRET ?? 'replace-this-development-secret',
  })
  await app.register(rateLimit, {
    global: false,
  })

  const requireAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify()
    } catch {
      return reply.code(401).send({ error: 'unauthorized' })
    }
  }

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error)
    if (error instanceof z.ZodError) {
      return validationError(reply, error)
    }
    if (!reply.sent) return reply.code(500).send({ error: 'internal_error' })
  })

  app.get('/api/v1/health', async () => ({
    status: 'ok',
    database: dataSource.options.type,
    time: new Date().toISOString(),
  }))

  app.get('/api/v1/stops', async (request) => {
    const query = z.object({ cityId: id.default('volgodonsk') }).parse(request.query)
    const stops = await dataSource.getRepository(Stop).find({
      where: { cityId: query.cityId, active: true },
      order: { name: 'ASC' },
    })
    return toGeoJson(stops)
  })

  app.get('/api/v1/routes', async (request) => {
    const query = z.object({ cityId: id.default('volgodonsk') }).parse(request.query)
    return { routes: await readRoutes(dataSource, query.cityId) }
  })

  app.get('/api/v1/stops/:stopId/forecasts', async (request, reply) => {
    const params = z.object({ stopId: id }).safeParse(request.params)
    if (!params.success) return validationError(reply, params.error)
    const forecasts = await dataSource.getRepository(Forecast).find({
      where: { stopId: params.data.stopId, active: true },
      order: { minMinutes: 'ASC' },
    })
    return {
      generatedAt: forecasts[0]?.calculatedAt.toISOString() ?? null,
      forecasts: forecasts.map((forecast) => ({
        stopId: forecast.stopId,
        routeId: forecast.routeId,
        directionId: forecast.directionId,
        minMinutes: forecast.minMinutes,
        maxMinutes: forecast.maxMinutes,
        confidence: forecast.confidence,
        sampleSize: forecast.sampleSize,
      })),
    }
  })

  app.post(
    '/api/v1/events/sync',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const input = syncSchema.safeParse(request.body)
      if (!input.success) return validationError(reply, input.error)

      const result = {
        accepted: [] as string[],
        duplicates: [] as string[],
        rejected: [] as object[],
      }
      const eventRepository = dataSource.getRepository(TransitEvent)
      const routeRepository = dataSource.getRepository(Route)
      const stopRepository = dataSource.getRepository(Stop)
      const directionStopRepository = dataSource.getRepository(DirectionStop)

      await dataSource.transaction(async (manager) => {
        for (const event of input.data.events) {
          if (await eventRepository.exist({ where: { id: event.id } })) {
            result.duplicates.push(event.id)
            continue
          }
          if (!(await routeRepository.exist({ where: { id: event.routeId, active: true } }))) {
            result.rejected.push({ id: event.id, reason: 'unknown_route' })
            continue
          }
          if (!(await stopRepository.exist({ where: { id: event.stopId, active: true } }))) {
            result.rejected.push({ id: event.id, reason: 'unknown_stop' })
            continue
          }
          if (
            event.directionId &&
            !(await directionStopRepository.exist({
              where: { directionId: event.directionId, stopId: event.stopId },
            }))
          ) {
            result.rejected.push({ id: event.id, reason: 'stop_not_on_direction' })
            continue
          }

          await manager.getRepository(TransitEvent).save({
            ...event,
            directionId: event.directionId ?? null,
            clientId: input.data.clientId,
            occurredAt: new Date(event.occurredAt),
          })
          result.accepted.push(event.id)
        }
      })
      return result
    },
  )

  app.post(
    '/api/v1/support/tickets',
    { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const input = ticketSchema.safeParse(request.body)
      if (!input.success) return validationError(reply, input.error)
      const token = createPublicToken()
      const ticket = await dataSource.getRepository(SupportTicket).save({
        id: randomUUID(),
        clientId: input.data.clientId,
        category: input.data.category,
        message: input.data.message,
        stopId: input.data.stopId ?? null,
        routeId: input.data.routeId ?? null,
        status: 'new',
        adminReply: null,
        publicTokenHash: hashPublicToken(token),
      })
      return reply.code(201).send({ id: ticket.id, token, status: ticket.status })
    },
  )

  app.get('/api/v1/support/tickets/:ticketId', async (request, reply) => {
    const parsed = z
      .object({ ticketId: id, token: z.string().min(20) })
      .safeParse({ ...(request.params as object), ...(request.query as object) })
    if (!parsed.success) return validationError(reply, parsed.error)
    const ticket = await dataSource
      .getRepository(SupportTicket)
      .findOneBy({ id: parsed.data.ticketId })
    if (!ticket || ticket.publicTokenHash !== hashPublicToken(parsed.data.token)) {
      return reply.code(404).send({ error: 'ticket_not_found' })
    }
    return {
      id: ticket.id,
      status: ticket.status,
      adminReply: ticket.adminReply,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
    }
  })

  app.post('/api/admin/auth/login', async (request, reply) => {
    const input = z
      .object({ email: z.email(), password: z.string().min(1).max(200) })
      .safeParse(request.body)
    if (!input.success) return validationError(reply, input.error)
    const admin = await dataSource
      .getRepository(Admin)
      .findOneBy({ email: input.data.email.toLowerCase(), active: true })
    if (!admin || !(await verifyPassword(input.data.password, admin.passwordHash))) {
      return reply.code(401).send({ error: 'invalid_credentials' })
    }
    return {
      token: app.jwt.sign({ sub: admin.id, email: admin.email }, { expiresIn: '12h' }),
      admin: { id: admin.id, email: admin.email },
    }
  })

  app.get('/api/admin/dashboard', { preHandler: requireAdmin }, async () => {
    const [cities, stops, routes, events, tickets] = await Promise.all([
      dataSource.getRepository(City).count(),
      dataSource.getRepository(Stop).count(),
      dataSource.getRepository(Route).count(),
      dataSource.getRepository(TransitEvent).count(),
      dataSource.getRepository(SupportTicket).countBy({ status: 'new' }),
    ])
    return { cities, stops, routes, events, newTickets: tickets }
  })

  app.get('/api/admin/cities', { preHandler: requireAdmin }, async () => ({
    cities: await dataSource.getRepository(City).find({ order: { name: 'ASC' } }),
  }))

  app.get('/api/admin/stops', { preHandler: requireAdmin }, async (request) => {
    const query = z
      .object({ cityId: id.default('volgodonsk'), q: z.string().default('') })
      .parse(request.query)
    const stops = await dataSource.getRepository(Stop).find({
      where: query.q
        ? [
            { cityId: query.cityId, name: Like(`%${query.q}%`) },
            { cityId: query.cityId, shortName: Like(`%${query.q}%`) },
          ]
        : { cityId: query.cityId },
      order: { name: 'ASC' },
    })
    return toGeoJson(stops)
  })

  app.post('/api/admin/stops', { preHandler: requireAdmin }, async (request, reply) => {
    const input = stopSchema.safeParse(request.body)
    if (!input.success) return validationError(reply, input.error)
    const saved = await dataSource.getRepository(Stop).save({
      ...input.data,
      id: input.data.id ?? randomUUID(),
      osmId: input.data.osmId ?? null,
      osmUrl: input.data.osmUrl ?? null,
    })
    return reply.code(201).send(saved)
  })

  app.put('/api/admin/stops/:stopId', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = z
      .object({ stopId: id, body: stopSchema })
      .safeParse({ ...(request.params as object), body: request.body })
    if (!parsed.success) return validationError(reply, parsed.error)
    const repository = dataSource.getRepository(Stop)
    if (!(await repository.exist({ where: { id: parsed.data.stopId } }))) {
      return reply.code(404).send({ error: 'stop_not_found' })
    }
    return repository.save({
      ...parsed.data.body,
      id: parsed.data.stopId,
      osmId: parsed.data.body.osmId ?? null,
      osmUrl: parsed.data.body.osmUrl ?? null,
    })
  })

  app.delete('/api/admin/stops/:stopId', { preHandler: requireAdmin }, async (request, reply) => {
    const params = z.object({ stopId: id }).safeParse(request.params)
    if (!params.success) return validationError(reply, params.error)
    if (
      await dataSource.getRepository(DirectionStop).exist({ where: { stopId: params.data.stopId } })
    ) {
      return reply.code(409).send({ error: 'stop_is_used_by_direction' })
    }
    await dataSource.getRepository(Stop).delete(params.data.stopId)
    return reply.code(204).send()
  })

  app.get('/api/admin/routes', { preHandler: requireAdmin }, async (request) => {
    const query = z.object({ cityId: id.optional() }).parse(request.query)
    return { routes: await readRoutes(dataSource, query.cityId, false, true) }
  })

  app.post('/api/admin/routes', { preHandler: requireAdmin }, async (request, reply) => {
    const input = routeSchema.safeParse(request.body)
    if (!input.success) return validationError(reply, input.error)
    const stopIds = [...new Set(input.data.directions.flatMap((direction) => direction.stopIds))]
    const existingStops = await dataSource.getRepository(Stop).countBy({ id: In(stopIds) })
    if (existingStops !== stopIds.length) {
      return reply.code(400).send({ error: 'unknown_stop_in_direction' })
    }

    await dataSource.transaction(async (manager) => {
      await manager.getRepository(Route).save({
        id: input.data.routeId,
        cityId: input.data.cityId,
        number: input.data.number,
        name: input.data.name ?? null,
        color: input.data.color,
        active: input.data.active,
        isMock: input.data.isMock,
      })

      const existingDirections = await manager
        .getRepository(Direction)
        .findBy({ routeId: input.data.routeId })
      const incomingIds = new Set(input.data.directions.map((direction) => direction.id))
      const removedIds = existingDirections
        .filter((direction) => !incomingIds.has(direction.id))
        .map((direction) => direction.id)
      if (removedIds.length) {
        await manager.getRepository(DirectionStop).delete({ directionId: In(removedIds) })
        await manager.getRepository(Schedule).delete({ directionId: In(removedIds) })
        await manager.getRepository(Direction).delete({ id: In(removedIds) })
      }

      for (const direction of input.data.directions) {
        await manager.getRepository(Direction).save({
          id: direction.id,
          routeId: input.data.routeId,
          name: direction.name,
          terminal: direction.terminal,
          routeType: direction.routeType,
          geometry: direction.geometry ?? null,
          routingPoints: direction.routingPoints,
          segments: direction.segments.map((seg) => ({
            fromStopId: seg.fromStopId,
            toStopId: seg.toStopId,
            status: seg.status,
            viaPoints: seg.viaPoints,
            geometry: seg.geometry ?? null,
            distanceMeters: seg.distanceMeters ?? null,
          })),
          distanceMeters: direction.distanceMeters ?? null,
          active: direction.active,
        })
        await manager.getRepository(DirectionStop).delete({ directionId: direction.id })
        await manager.getRepository(DirectionStop).save(
          direction.stopIds.map((stopId, position) => ({
            directionId: direction.id,
            stopId,
            position,
          })),
        )
      }
    })
    return reply.code(201).send({ routeId: input.data.routeId })
  })

  app.delete('/api/admin/routes/:routeId', { preHandler: requireAdmin }, async (request, reply) => {
    const params = z.object({ routeId: id }).safeParse(request.params)
    if (!params.success) return validationError(reply, params.error)
    const directions = await dataSource
      .getRepository(Direction)
      .findBy({ routeId: params.data.routeId })
    const directionIds = directions.map((direction) => direction.id)
    await dataSource.transaction(async (manager) => {
      if (directionIds.length) {
        await manager.getRepository(DirectionStop).delete({ directionId: In(directionIds) })
        await manager.getRepository(Schedule).delete({ directionId: In(directionIds) })
        await manager.getRepository(Direction).delete({ id: In(directionIds) })
      }
      await manager.getRepository(Forecast).delete({ routeId: params.data.routeId })
      await manager.getRepository(Route).delete(params.data.routeId)
    })
    return reply.code(204).send()
  })

  app.post('/api/admin/routing/route', { preHandler: requireAdmin }, async (request, reply) => {
    const input = z
      .object({
        coordinates: z
          .array(z.tuple([coordinate, coordinate]))
          .min(2)
          .max(100),
      })
      .safeParse(request.body)
    if (!input.success) return validationError(reply, input.error)
    const routerUrl =
      process.env.ROUTER_URL ?? 'https://routing.openstreetmap.de/routed-car/route/v1/driving'
    const coordinates = input.data.coordinates.map((point) => point.join(',')).join(';')
    const response = await fetch(
      `${routerUrl}/${coordinates}?overview=full&geometries=geojson&steps=false`,
    )
    if (!response.ok) return reply.code(502).send({ error: 'routing_service_unavailable' })
    const payload = (await response.json()) as {
      code: string
      routes?: Array<{ distance: number; geometry: object }>
    }
    const route = payload.routes?.[0]
    if (!route) return reply.code(422).send({ error: 'route_not_found' })
    return { distanceMeters: Math.round(route.distance), geometry: route.geometry }
  })

  app.post('/api/admin/routing/segment', { preHandler: requireAdmin }, async (request, reply) => {
    const input = z
      .object({
        from: z.tuple([coordinate, coordinate]),
        to: z.tuple([coordinate, coordinate]),
        via: z.array(z.tuple([coordinate, coordinate])).max(50).default([]),
      })
      .safeParse(request.body)
    if (!input.success) return validationError(reply, input.error)
    const allPoints = [input.data.from, ...input.data.via, input.data.to]
    const routerUrl =
      process.env.ROUTER_URL ?? 'https://routing.openstreetmap.de/routed-car/route/v1/driving'
    const coordinates = allPoints.map((point) => point.join(',')).join(';')
    const response = await fetch(
      `${routerUrl}/${coordinates}?overview=full&geometries=geojson&steps=false`,
    )
    if (!response.ok) return reply.code(502).send({ error: 'routing_service_unavailable' })
    const payload = (await response.json()) as {
      code: string
      routes?: Array<{ distance: number; geometry: object }>
    }
    const route = payload.routes?.[0]
    if (!route) return reply.code(422).send({ error: 'segment_not_found' })
    return { distanceMeters: Math.round(route.distance), geometry: route.geometry }
  })

  app.get('/api/admin/schedules', { preHandler: requireAdmin }, async (request) => {
    const query = z
      .object({ directionId: id.optional(), stopId: id.optional() })
      .parse(request.query)
    return {
      schedules: await dataSource.getRepository(Schedule).find({
        where: {
          ...(query.directionId ? { directionId: query.directionId } : {}),
          ...(query.stopId ? { stopId: query.stopId } : {}),
        },
        order: { directionId: 'ASC', departureTime: 'ASC', startTime: 'ASC' },
      }),
    }
  })

  app.post('/api/admin/schedules', { preHandler: requireAdmin }, async (request, reply) => {
    const input = scheduleSchema.safeParse(request.body)
    if (!input.success) return validationError(reply, input.error)
    if (
      !(await dataSource.getRepository(Direction).exist({ where: { id: input.data.directionId } }))
    ) {
      return reply.code(400).send({ error: 'unknown_direction' })
    }
    if (
      input.data.stopId &&
      !(await dataSource.getRepository(DirectionStop).exist({
        where: { directionId: input.data.directionId, stopId: input.data.stopId },
      }))
    ) {
      return reply.code(400).send({ error: 'stop_is_not_in_direction' })
    }
    const saved = await dataSource.getRepository(Schedule).save({
      ...input.data,
      id: input.data.id ?? randomUUID(),
      stopId: input.data.stopId ?? null,
      departureTime: input.data.type === 'exact' ? (input.data.departureTime ?? null) : null,
      startTime: input.data.type === 'interval' ? (input.data.startTime ?? null) : null,
      endTime: input.data.type === 'interval' ? (input.data.endTime ?? null) : null,
      headwayMinutes: input.data.type === 'interval' ? (input.data.headwayMinutes ?? null) : null,
    })
    return reply.code(201).send(saved)
  })

  app.delete(
    '/api/admin/schedules/:scheduleId',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const params = z.object({ scheduleId: id }).safeParse(request.params)
      if (!params.success) return validationError(reply, params.error)
      await dataSource.getRepository(Schedule).delete(params.data.scheduleId)
      return reply.code(204).send()
    },
  )

  app.get('/api/admin/forecasts', { preHandler: requireAdmin }, async () => ({
    forecasts: await dataSource.getRepository(Forecast).find({ order: { calculatedAt: 'DESC' } }),
  }))

  app.post('/api/admin/forecasts', { preHandler: requireAdmin }, async (request, reply) => {
    const input = forecastSchema.safeParse(request.body)
    if (!input.success) return validationError(reply, input.error)
    if (input.data.maxMinutes < input.data.minMinutes) {
      return reply.code(400).send({ error: 'invalid_forecast_range' })
    }
    const saved = await dataSource.getRepository(Forecast).save({
      ...input.data,
      id: input.data.id ?? randomUUID(),
      directionId: input.data.directionId ?? null,
      calculatedAt: new Date(),
    })
    return reply.code(201).send(saved)
  })

  app.delete(
    '/api/admin/forecasts/:forecastId',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const params = z.object({ forecastId: id }).safeParse(request.params)
      if (!params.success) return validationError(reply, params.error)
      await dataSource.getRepository(Forecast).delete(params.data.forecastId)
      return reply.code(204).send()
    },
  )

  app.get('/api/admin/events', { preHandler: requireAdmin }, async () => ({
    events: await dataSource
      .getRepository(TransitEvent)
      .find({ order: { receivedAt: 'DESC' }, take: 500 }),
  }))

  app.delete(
    '/api/admin/events/:eventId',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const params = z.object({ eventId: id }).safeParse(request.params)
      if (!params.success) return validationError(reply, params.error)
      await dataSource.getRepository(TransitEvent).delete(params.data.eventId)
      return reply.code(204).send()
    },
  )

  app.get('/api/admin/support/tickets', { preHandler: requireAdmin }, async () => ({
    tickets: await dataSource
      .getRepository(SupportTicket)
      .find({ order: { createdAt: 'DESC' }, take: 500 }),
  }))

  app.patch(
    '/api/admin/support/tickets/:ticketId',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const input = z
        .object({
          ticketId: id,
          status: z.enum(['new', 'in_progress', 'resolved', 'rejected']),
          adminReply: z.string().trim().max(4000).nullable(),
        })
        .safeParse({ ...(request.params as object), ...(request.body as object) })
      if (!input.success) return validationError(reply, input.error)
      const repository = dataSource.getRepository(SupportTicket)
      const ticket = await repository.findOneBy({ id: input.data.ticketId })
      if (!ticket) return reply.code(404).send({ error: 'ticket_not_found' })
      ticket.status = input.data.status
      ticket.adminReply = input.data.adminReply
      return repository.save(ticket)
    },
  )

  return app
}
