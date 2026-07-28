import { describe, expect, it } from 'vitest'

import {
  nextScheduledArrival,
  observedVehicleInstanceId,
  scheduleLabelsForToday,
  scheduledArrivalIso,
  servicesForStop,
} from './schedule'
import type { RouteSchedule, TransitRoute } from '@/types/transit'

const dailyInterval: RouteSchedule = {
  id: 'daily',
  stopId: 'lazorevyi',
  days: [1, 2, 3, 4, 5, 6, 7],
  type: 'interval',
  departureTime: null,
  startTime: '06:16',
  endTime: '23:16',
  headwayMinutes: 20,
}

describe('schedule arrivals', () => {
  it('calculates the next bus from a stop interval', () => {
    const arrival = nextScheduledArrival([dailyInterval], new Date('2026-07-27T03:21:00Z'))

    expect(arrival).toMatchObject({
      time: '06:36',
      minutesUntil: 15,
      dayOffset: 0,
      timeLabel: '06:36',
      relativeLabel: 'через 15 мин',
    })
  })

  it('moves to the first bus of the next service day after the interval ends', () => {
    const arrival = nextScheduledArrival([dailyInterval], new Date('2026-07-27T20:17:00Z'))

    expect(arrival).toMatchObject({
      time: '06:16',
      minutesUntil: 419,
      dayOffset: 1,
      timeLabel: 'завтра, 06:16',
    })
  })

  it('shows operating hours and interval for the current day', () => {
    expect(scheduleLabelsForToday([dailyInterval], new Date('2026-07-27T10:00:00Z'))).toEqual([
      '06:16–23:16 · каждые 20 мин',
    ])
  })

  it('uses the Moscow service date around UTC midnight', () => {
    const now = new Date('2026-07-27T21:30:00.000Z')
    const arrival = nextScheduledArrival([dailyInterval], now)
    expect(arrival).toMatchObject({ time: '06:16', dayOffset: 0 })
    expect(scheduledArrivalIso(arrival!, now)).toBe('2026-07-28T03:16:00.000Z')
    expect(observedVehicleInstanceId('3k', 'forward', now)).toBe(
      '2026-07-28::3k::forward::observed-00:30',
    )
  })
})

describe('stop services', () => {
  it('finds a route from its stop sequence even without a forecast', () => {
    const routes: TransitRoute[] = [
      {
        routeId: '3k',
        number: '3К',
        color: '#0074dc',
        directions: [
          {
            id: 'forward',
            name: 'к Артемиде',
            terminal: 'Артемида',
            stopIds: ['vzmeo', 'lazorevyi', 'artemida'],
            schedules: [dailyInterval],
          },
        ],
      },
    ]

    const services = servicesForStop('lazorevyi', routes, [], [], new Date('2026-07-27T03:21:00Z'))

    expect(services).toHaveLength(1)
    expect(services[0]).toMatchObject({
      route: { routeId: '3k', number: '3К' },
      direction: { id: 'forward' },
      nextArrival: { time: '06:36', minutesUntil: 15 },
    })
  })

  it('builds trip ids from the Moscow calendar date', () => {
    const routes: TransitRoute[] = [
      {
        routeId: '3k',
        number: '3К',
        color: '#0074dc',
        directions: [
          {
            id: 'forward',
            name: 'к Артемиде',
            terminal: 'Артемида',
            stopIds: ['lazorevyi'],
            schedules: [dailyInterval],
          },
        ],
      },
    ]

    const services = servicesForStop(
      'lazorevyi',
      routes,
      [],
      [],
      new Date('2026-07-27T21:30:00.000Z'),
    )

    expect(services[0]?.tripId).toMatch(/^2026-07-28::3k::forward::/)
  })
})
