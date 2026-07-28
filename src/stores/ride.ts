import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import {
  listEvents,
  loadActiveRide,
  removeActiveRide,
  saveActiveRide,
  saveEvent,
  type TransitEvent,
} from '@/lib/db'
import { nextStopIndex } from '@/lib/forecast'
import { syncPendingEvents } from '@/lib/sync'
import type { ActiveRide, RouteDirection, TransitRoute } from '@/types/transit'

export const useRideStore = defineStore('ride', () => {
  const activeRide = ref<ActiveRide | null>(null)
  const events = ref<TransitEvent[]>([])
  const justSavedStopId = ref<string | null>(null)
  const initialised = ref(false)

  const isActive = computed(() => activeRide.value !== null)
  const pendingCount = computed(
    () => events.value.filter((event) => event.status === 'pending').length,
  )

  async function initialise() {
    if (initialised.value) return
    const [storedRide, storedEvents] = await Promise.all([loadActiveRide(), listEvents()])
    activeRide.value = storedRide ?? null
    events.value = storedEvents
    initialised.value = true
    await trySync()
  }

  async function trySync() {
    try {
      const result = await syncPendingEvents()
      if (result) await refreshEvents()
    } catch {
      // Offline-first: pending events stay queued for the next attempt.
    }
  }

  async function refreshEvents() {
    events.value = await listEvents()
  }

  async function recordArrival(routeId: string, stopId: string, directionId: string | null) {
    const saved = await saveEvent({
      type: 'bus_arrival',
      routeId,
      directionId,
      stopId,
    })
    events.value = [saved, ...events.value].slice(0, 50)
    justSavedStopId.value = stopId
    void trySync()
    return saved
  }

  async function recordMissing(routeId: string, stopId: string, directionId: string | null) {
    const saved = await saveEvent({
      type: 'bus_missing',
      routeId,
      directionId,
      stopId,
    })
    events.value = [saved, ...events.value].slice(0, 50)
    justSavedStopId.value = stopId
    void trySync()
    return saved
  }

  async function startRide(
    route: TransitRoute,
    direction: RouteDirection,
    startStopId: string,
    vehicleInstanceId: string | null = null,
    scheduledArrival: string | null = null,
  ) {
    if (activeRide.value) return activeRide.value

    const startIndex = direction.stopIds.indexOf(startStopId)
    const ride: ActiveRide = {
      id: 'current',
      routeId: route.routeId,
      directionId: direction.id,
      vehicleInstanceId,
      boardingStopId: startStopId,
      scheduledArrival,
      nextStopIndex: startIndex >= 0 ? startIndex + 1 : 0,
      startedAt: new Date().toISOString(),
      lastLongitude: null,
      lastLatitude: null,
      lastHeading: null,
      lastLocationAt: null,
    }

    await saveActiveRide(ride)
    activeRide.value = ride
    justSavedStopId.value = null
    return ride
  }

  async function boardBus(
    route: TransitRoute,
    direction: RouteDirection,
    startStopId: string,
    vehicleInstanceId: string | null = null,
    scheduledArrival: string | null = null,
  ) {
    if (activeRide.value) {
      const sameVehicle =
        Boolean(vehicleInstanceId) && activeRide.value.vehicleInstanceId === vehicleInstanceId
      if (sameVehicle) return null

      const shouldSwitch = window.confirm(
        'Вы уже едете в другом автобусе. Чтобы выбрать этот рейс, нужно завершить текущую поездку.\n\nЗавершить текущую поездку и пересесть?',
      )
      if (!shouldSwitch) return null
      await finishRide()
    }

    const arrival = await saveEvent({
      type: 'bus_arrival',
      routeId: route.routeId,
      directionId: direction.id,
      vehicleInstanceId,
      scheduledArrival,
      stopId: startStopId,
    })
    events.value = [arrival, ...events.value].slice(0, 50)
    await startRide(route, direction, startStopId, vehicleInstanceId, scheduledArrival)
    void trySync()
    return arrival
  }

  async function updateLocation(
    longitude: number,
    latitude: number,
    heading: number | null = null,
  ) {
    if (!activeRide.value) return

    const updatedRide: ActiveRide = {
      ...activeRide.value,
      lastLongitude: longitude,
      lastLatitude: latitude,
      lastHeading: Number.isFinite(heading) ? heading : null,
      lastLocationAt: new Date().toISOString(),
    }
    activeRide.value = updatedRide
    await saveActiveRide(updatedRide)
  }

  async function markNextStop(direction: RouteDirection) {
    if (!activeRide.value) return null

    const stopId = direction.stopIds[activeRide.value.nextStopIndex]
    if (!stopId) return null

    const saved = await saveEvent({
      type: 'stop_passage',
      routeId: activeRide.value.routeId,
      directionId: activeRide.value.directionId,
      vehicleInstanceId: activeRide.value.vehicleInstanceId ?? null,
      scheduledArrival: null,
      stopId,
    })

    const updatedRide: ActiveRide = {
      ...activeRide.value,
      nextStopIndex: nextStopIndex(activeRide.value.nextStopIndex, direction.stopIds.length),
    }
    await saveActiveRide(updatedRide)
    activeRide.value = updatedRide
    events.value = [saved, ...events.value].slice(0, 50)
    justSavedStopId.value = stopId
    void trySync()
    return saved
  }

  async function finishRide() {
    await removeActiveRide()
    activeRide.value = null
    justSavedStopId.value = null
  }

  return {
    activeRide,
    events,
    justSavedStopId,
    isActive,
    pendingCount,
    initialise,
    refreshEvents,
    recordArrival,
    recordMissing,
    startRide,
    boardBus,
    updateLocation,
    markNextStop,
    finishRide,
    trySync,
  }
})