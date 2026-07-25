import { apiIsConfigured, apiUrl } from '@/lib/api'
import { listPendingEvents, updateEventStatuses } from '@/lib/db'

interface SyncResponse {
  accepted: string[]
  duplicates: string[]
  rejected: Array<{ id: string; reason: string }>
}

export async function syncPendingEvents(fetcher: typeof fetch = fetch) {
  if (!apiIsConfigured() || !navigator.onLine) return null
  const events = await listPendingEvents()
  if (!events.length) return null

  const clientId = events[0]?.clientId
  if (!clientId) return null
  const response = await fetcher(apiUrl('/api/v1/events/sync'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId,
      events: events.map((event) => ({
        id: event.id,
        type: event.type,
        routeId: event.routeId,
        directionId: event.directionId,
        stopId: event.stopId,
        occurredAt: event.createdAt,
      })),
    }),
  })
  if (!response.ok) throw new Error(`Синхронизация не выполнена: ${response.status}`)

  const result = (await response.json()) as SyncResponse
  await updateEventStatuses(
    [...result.accepted, ...result.duplicates],
    result.rejected.map((event) => event.id),
  )
  return result
}
