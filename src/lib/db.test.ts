import 'fake-indexeddb/auto'

import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

const storage = new Map<string, string>()

beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  })
})

describe('offline event queue', () => {
  beforeEach(async () => {
    storage.clear()
    const { db } = await import('./db')
    await db.stopPassages.clear()
  })

  it('stores a stop passage as a pending local event', async () => {
    const { db, pendingEventCount, saveStopPassage } = await import('./db')

    const event = await saveStopPassage({
      routeId: '14',
      directionId: '14-outbound',
      stopId: 'stop-druzhby',
    })

    expect(event.syncStatus).toBe('pending')
    expect(await pendingEventCount()).toBe(1)
    expect(await db.stopPassages.get(event.id)).toMatchObject({
      routeId: '14',
      stopId: 'stop-druzhby',
    })
  })
})
