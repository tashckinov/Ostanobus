import 'reflect-metadata'

import { resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DataSource } from 'typeorm'

import { createApp } from './app.js'
import { createDataSource } from './data-source.js'
import { seedDatabase } from './seed.js'

describe('pilot backend', () => {
  let dataSource: DataSource
  let app: Awaited<ReturnType<typeof createApp>>
  let adminToken = ''

  beforeAll(async () => {
    process.env.ADMIN_EMAIL = 'admin@example.test'
    process.env.ADMIN_PASSWORD = 'test-password'
    dataSource = createDataSource({
      sqlitePath: ':memory:',
      synchronize: true,
      dropSchema: true,
    })
    await dataSource.initialize()
    await seedDatabase(dataSource, resolve('../public/data'))
    app = await createApp({ dataSource, logger: false })
    const login = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: { email: 'admin@example.test', password: 'test-password' },
    })
    adminToken = login.json().token
  })

  afterAll(async () => {
    await app.close()
    await dataSource.destroy()
  })

  it('serves health, stops, routes and forecasts', async () => {
    const health = await app.inject({ method: 'GET', url: '/api/v1/health' })
    expect(health.statusCode).toBe(200)
    expect(health.json()).toMatchObject({ status: 'ok', database: 'better-sqlite3' })

    const stops = await app.inject({ method: 'GET', url: '/api/v1/stops' })
    expect(stops.statusCode).toBe(200)
    expect(stops.json().features.length).toBeGreaterThan(200)

    const routes = await app.inject({ method: 'GET', url: '/api/v1/routes' })
    expect(routes.statusCode).toBe(200)
    expect(routes.json().routes[0]).toMatchObject({ routeId: '3k', number: '3К' })
    expect(routes.json().routes[0].directions[0].geometry.coordinates.length).toBeGreaterThan(20)

    const forecasts = await app.inject({
      method: 'GET',
      url: '/api/v1/stops/osm-node-9054348906/forecasts',
    })
    expect(forecasts.statusCode).toBe(200)
    expect(forecasts.json().forecasts).toHaveLength(1)
  })

  it('accepts a batch once and reports a retry as duplicate', async () => {
    const payload = {
      clientId: 'device-test',
      events: [
        {
          id: 'event-test',
          type: 'bus_arrival',
          routeId: '3k',
          directionId: '3k-vzmeo-artemida',
          stopId: 'osm-node-9054348906',
          occurredAt: '2026-07-26T10:00:00.000Z',
        },
      ],
    }
    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/events/sync',
      payload,
    })
    expect(accepted.statusCode).toBe(200)
    expect(accepted.json()).toMatchObject({ accepted: ['event-test'], duplicates: [] })

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/events/sync',
      payload,
    })
    expect(duplicate.statusCode).toBe(200)
    expect(duplicate.json()).toMatchObject({ accepted: [], duplicates: ['event-test'] })
  })

  it('creates an anonymous support ticket and exposes it to an administrator', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/support/tickets',
      payload: {
        clientId: 'device-test',
        category: 'schedule',
        message: 'Неверное время отправления',
        routeId: '3k',
      },
    })
    expect(created.statusCode).toBe(201)
    const ticket = created.json()

    const publicStatus = await app.inject({
      method: 'GET',
      url: `/api/v1/support/tickets/${ticket.id}?token=${ticket.token}`,
    })
    expect(publicStatus.statusCode).toBe(200)
    expect(publicStatus.json().status).toBe('new')

    const tickets = await app.inject({
      method: 'GET',
      url: '/api/admin/support/tickets',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(tickets.statusCode).toBe(200)
    expect(tickets.json().tickets[0].message).toBe('Неверное время отправления')
  })

  it('routes through every correction point in the requested order', async () => {
    const router = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'Ok',
          routes: [
            {
              distance: 1234,
              geometry: {
                type: 'LineString',
                coordinates: [
                  [42.1, 47.1],
                  [42.2, 47.2],
                  [42.3, 47.3],
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/routing/route',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          coordinates: [
            [42.1, 47.1],
            [42.2, 47.2],
            [42.3, 47.3],
          ],
        },
      })

      expect(response.statusCode).toBe(200)
      expect(String(router.mock.calls[0]?.[0])).toContain('/42.1,47.1;42.2,47.2;42.3,47.3?')
    } finally {
      router.mockRestore()
    }
  })

  it('stores a route-specific road anchor without changing the stop', async () => {
    const routesResponse = await app.inject({
      method: 'GET',
      url: '/api/admin/routes?cityId=volgodonsk',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    const route = routesResponse.json().routes[0]
    const firstPoint = route.directions[0].routingPoints[0]
    route.directions[0].routingPoints[0] = {
      ...firstPoint,
      longitude: 42.2101,
      latitude: 47.5301,
    }

    const saved = await app.inject({
      method: 'POST',
      url: '/api/admin/routes',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: route,
    })
    expect(saved.statusCode).toBe(201)

    const updatedRoutes = await app.inject({
      method: 'GET',
      url: '/api/admin/routes?cityId=volgodonsk',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(updatedRoutes.json().routes[0].directions[0].routingPoints[0]).toMatchObject({
      type: 'stop',
      stopId: firstPoint.stopId,
      longitude: 42.2101,
      latitude: 47.5301,
    })
  })

  it('stores a schedule for a concrete stop in a direction', async () => {
    const routes = await app.inject({
      method: 'GET',
      url: '/api/admin/routes?cityId=volgodonsk',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    const direction = routes.json().routes[0].directions[0]
    const stopId = direction.stopIds[0]

    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/schedules',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        directionId: direction.id,
        stopId,
        days: [1, 2, 3, 4, 5],
        type: 'interval',
        departureTime: null,
        startTime: '06:00',
        endTime: '09:00',
        headwayMinutes: 15,
        active: true,
      },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({ directionId: direction.id, stopId })

    const rejected = await app.inject({
      method: 'POST',
      url: '/api/admin/schedules',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        directionId: direction.id,
        stopId: 'not-in-this-direction',
        days: [1],
        type: 'exact',
        departureTime: '07:30',
        startTime: null,
        endTime: null,
        headwayMinutes: null,
        active: true,
      },
    })
    expect(rejected.statusCode).toBe(400)
    expect(rejected.json()).toMatchObject({ error: 'stop_is_not_in_direction' })
  })
})
