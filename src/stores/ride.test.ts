import 'fake-indexeddb/auto'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { db, loadActiveRide } from '@/lib/db'
import type { RouteDirection, TransitRoute } from '@/types/transit'

import { useRideStore } from './ride'

const direction: RouteDirection = {
  id: '3k-vzmeo-artemida',
  name: 'к магазину «Артемида»',
  terminal: 'Магазин Артемида',
  stopIds: ['stop-a', 'stop-b'],
}

const route: TransitRoute = {
  routeId: '3k',
  number: '3К',
  color: '#0074dc',
  isMock: true,
  directions: [direction],
}

describe('ride scenario', () => {
  beforeEach(async () => {
    await Promise.all([db.events.clear(), db.activeRide.clear(), db.settings.clear()])
    setActivePinia(createPinia())
  })

  it('starts from the selected stop and stores the next passage as pending', async () => {
    const ride = useRideStore()
    await ride.initialise()

    await ride.startRide(route, direction, 'stop-a')
    expect(ride.activeRide?.nextStopIndex).toBe(1)
    expect(await loadActiveRide()).toMatchObject({ nextStopIndex: 1 })

    const event = await ride.markNextStop(direction)
    expect(event).toMatchObject({
      type: 'stop_passage',
      stopId: 'stop-b',
      status: 'pending',
    })
    expect(ride.pendingCount).toBe(1)
    expect(ride.activeRide?.nextStopIndex).toBe(2)
  })
})
