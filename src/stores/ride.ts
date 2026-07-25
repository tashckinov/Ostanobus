import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { nextStopIndex } from '@/lib/forecast'
import { pendingEventCount, saveStopPassage } from '@/lib/db'
import type { ActiveRide, RouteDirection, TransitRoute } from '@/types/transit'

const activeRideKey = 'ostanobus-active-ride'

function restoreRide(): ActiveRide | null {
  try {
    const stored = localStorage.getItem(activeRideKey)
    return stored ? (JSON.parse(stored) as ActiveRide) : null
  } catch {
    return null
  }
}

export const useRideStore = defineStore('ride', () => {
  const activeRide = ref<ActiveRide | null>(restoreRide())
  const pendingCount = ref(0)
  const justSavedStopId = ref<string | null>(null)

  const isActive = computed(() => activeRide.value !== null)

  function persist() {
    if (activeRide.value) {
      localStorage.setItem(activeRideKey, JSON.stringify(activeRide.value))
    } else {
      localStorage.removeItem(activeRideKey)
    }
  }

  async function refreshPendingCount() {
    pendingCount.value = await pendingEventCount()
  }

  function startRide(route: TransitRoute, direction: RouteDirection) {
    activeRide.value = {
      routeId: route.routeId,
      directionId: direction.id,
      nextStopIndex: 0,
      startedAt: new Date().toISOString(),
    }
    persist()
  }

  async function markNextStop(direction: RouteDirection) {
    if (!activeRide.value) return null

    const stopId = direction.stopIds[activeRide.value.nextStopIndex]
    if (!stopId) return null

    const saved = await saveStopPassage({
      routeId: activeRide.value.routeId,
      directionId: activeRide.value.directionId,
      stopId,
    })

    activeRide.value.nextStopIndex = nextStopIndex(
      activeRide.value.nextStopIndex,
      direction.stopIds.length,
    )
    justSavedStopId.value = stopId
    persist()
    await refreshPendingCount()
    return saved
  }

  function finishRide() {
    activeRide.value = null
    justSavedStopId.value = null
    persist()
  }

  return {
    activeRide,
    pendingCount,
    justSavedStopId,
    isActive,
    refreshPendingCount,
    startRide,
    markNextStop,
    finishRide,
  }
})
