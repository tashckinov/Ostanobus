import Dexie, { type EntityTable } from 'dexie'

export interface StopPassageEvent {
  id: string
  clientId: string
  routeId: string
  directionId: string
  stopId: string
  createdAt: string
  syncStatus: 'pending'
}

class OstanobusDatabase extends Dexie {
  stopPassages!: EntityTable<StopPassageEvent, 'id'>

  constructor() {
    super('ostanobus')
    this.version(1).stores({
      stopPassages: 'id, createdAt, routeId, stopId, syncStatus',
    })
  }
}

export const db = new OstanobusDatabase()

function getClientId() {
  const key = 'ostanobus-client-id'
  const existing = localStorage.getItem(key)
  if (existing) return existing

  const clientId = crypto.randomUUID()
  localStorage.setItem(key, clientId)
  return clientId
}

export async function saveStopPassage(
  event: Omit<StopPassageEvent, 'id' | 'clientId' | 'createdAt' | 'syncStatus'>,
) {
  const saved: StopPassageEvent = {
    ...event,
    id: crypto.randomUUID(),
    clientId: getClientId(),
    createdAt: new Date().toISOString(),
    syncStatus: 'pending',
  }

  await db.stopPassages.add(saved)
  return saved
}

export function pendingEventCount() {
  return db.stopPassages.where('syncStatus').equals('pending').count()
}
