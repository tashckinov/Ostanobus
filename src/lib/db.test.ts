import 'fake-indexeddb/auto'

import { beforeEach, describe, expect, it } from 'vitest'

import { db, loadActiveRide, pendingEventCount, saveActiveRide, saveEvent } from './db'

describe('offline data', () => {
  beforeEach(async () => {
    await Promise.all([db.events.clear(), db.activeRide.clear(), db.settings.clear()])
  })

  it('stores an arrival as a pending event', async () => {
    const event = await saveEvent({
      type: 'bus_arrival',
      routeId: '3k',
      directionId: '3k-vzmeo-artemida',
      stopId: 'osm-node-9054348906',
    })

    expect(event.status).toBe('pending')
    expect(await pendingEventCount()).toBe(1)
    expect(await db.events.get(event.id)).toMatchObject({
      type: 'bus_arrival',
      routeId: '3k',
    })
    expect(await db.settings.get('clientId')).toBeDefined()
  })

  it('persists the active ride separately from events', async () => {
    await saveActiveRide({
      id: 'current',
      routeId: '3k',
      directionId: '3k-vzmeo-artemida',
      nextStopIndex: 2,
      startedAt: '2026-07-25T19:30:00.000Z',
    })

    expect(await loadActiveRide()).toMatchObject({
      id: 'current',
      nextStopIndex: 2,
    })
    expect(db.tables.map((table) => table.name).sort()).toEqual([
      'activeRide',
      'events',
      'settings',
    ])
  })
})
