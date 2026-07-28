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

  it('records boarding and starts from the selected stop with one action', async () => {
    const ride = useRideStore()
    await ride.initialise()

    const arrival = await ride.boardBus(
      route,
      direction,
      'stop-a',
      '2026-07-28::3k::3k-vzmeo-artemida::10:00',
      '2026-07-28T07:00:00.000Z',
    )
    expect(arrival).toMatchObject({
      type: 'bus_arrival',
      routeId: '3k',
      directionId: '3k-vzmeo-artemida',
      vehicleInstanceId: '2026-07-28::3k::3k-vzmeo-artemida::10:00',
      scheduledArrival: '2026-07-28T07:00:00.000Z',
      stopId: 'stop-a',
      status: 'pending',
    })
    expect(ride.activeRide?.nextStopIndex).toBe(1)
    expect(await loadActiveRide()).toMatchObject({
      nextStopIndex: 1,
      vehicleInstanceId: '2026-07-28::3k::3k-vzmeo-artemida::10:00',
    })
    expect(ride.pendingCount).toBe(1)

    const event = await ride.markNextStop(direction)
    expect(event).toMatchObject({
      type: 'stop_passage',
      stopId: 'stop-b',
      vehicleInstanceId: '2026-07-28::3k::3k-vzmeo-artemida::10:00',
      status: 'pending',
    })
    expect(ride.pendingCount).toBe(2)
    expect(ride.activeRide?.nextStopIndex).toBe(2)
  })
})
