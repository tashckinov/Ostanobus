import 'reflect-metadata'

import { resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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

    const login = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: { email: 'admin@example.test', password: 'test-password' },
    })
    expect(login.statusCode).toBe(200)
    adminToken = login.json().token

    const tickets = await app.inject({
      method: 'GET',
      url: '/api/admin/support/tickets',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(tickets.statusCode).toBe(200)
    expect(tickets.json().tickets[0].message).toBe('Неверное время отправления')
  })
})
