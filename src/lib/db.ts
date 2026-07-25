import Dexie, { type EntityTable } from 'dexie'

import type { ActiveRide } from '@/types/transit'

export type TransitEventType = 'bus_arrival' | 'stop_passage'

export interface TransitEvent {
  id: string
  clientId: string
  type: TransitEventType
  routeId: string
  directionId: string | null
  stopId: string
  createdAt: string
  status: 'pending'
}

export interface AppSetting {
  key: string
  value: unknown
  updatedAt: string
}

class OstanobusDatabase extends Dexie {
  events!: EntityTable<TransitEvent, 'id'>
  activeRide!: EntityTable<ActiveRide, 'id'>
  settings!: EntityTable<AppSetting, 'key'>

  constructor() {
    super('ostanobus')

    this.version(1).stores({
      stopPassages: 'id, createdAt, routeId, stopId, syncStatus',
    })

    this.version(2)
      .stores({
        stopPassages: 'id, createdAt, routeId, stopId, syncStatus',
        events: 'id, createdAt, type, routeId, stopId, status',
        activeRide: 'id, routeId, directionId',
        settings: 'key',
      })
      .upgrade(async (transaction) => {
        const legacyEvents = await transaction.table('stopPassages').toArray()
        if (!legacyEvents.length) return

        await transaction.table('events').bulkAdd(
          legacyEvents.map((event) => ({
            id: event.id,
            clientId: event.clientId,
            type: 'stop_passage',
            routeId: event.routeId,
            directionId: event.directionId ?? null,
            stopId: event.stopId,
            createdAt: event.createdAt,
            status: 'pending',
          })),
        )
      })

    this.version(3).stores({
      stopPassages: null,
      events: 'id, createdAt, type, routeId, stopId, status',
      activeRide: 'id, routeId, directionId',
      settings: 'key',
    })
  }
}

export const db = new OstanobusDatabase()

async function getClientId() {
  const existing = await db.settings.get('clientId')
  if (typeof existing?.value === 'string') return existing.value

  const clientId = crypto.randomUUID()
  await db.settings.put({
    key: 'clientId',
    value: clientId,
    updatedAt: new Date().toISOString(),
  })
  return clientId
}

export async function saveEvent(
  event: Omit<TransitEvent, 'id' | 'clientId' | 'createdAt' | 'status'>,
) {
  const saved: TransitEvent = {
    ...event,
    id: crypto.randomUUID(),
    clientId: await getClientId(),
    createdAt: new Date().toISOString(),
    status: 'pending',
  }

  await db.events.add(saved)
  return saved
}

export function listEvents(limit = 50) {
  return db.events.orderBy('createdAt').reverse().limit(limit).toArray()
}

export function pendingEventCount() {
  return db.events.where('status').equals('pending').count()
}

export function loadActiveRide() {
  return db.activeRide.get('current')
}

export function saveActiveRide(ride: ActiveRide) {
  return db.activeRide.put(ride)
}

export function removeActiveRide() {
  return db.activeRide.delete('current')
}
