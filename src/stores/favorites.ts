import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

const STORAGE_KEY = 'ostanobus-favorites-v1'

interface FavoritesState {
  routeIds: string[]
  stopIds: string[]
}

function load(): FavoritesState {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<FavoritesState>
    return {
      routeIds: Array.isArray(value.routeIds) ? value.routeIds : [],
      stopIds: Array.isArray(value.stopIds) ? value.stopIds : [],
    }
  } catch {
    return { routeIds: [], stopIds: [] }
  }
}

export const useFavoritesStore = defineStore('favorites', () => {
  const initial = load()
  const routeIds = ref(initial.routeIds)
  const stopIds = ref(initial.stopIds)

  const routeSet = computed(() => new Set(routeIds.value))
  const stopSet = computed(() => new Set(stopIds.value))

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ routeIds: routeIds.value, stopIds: stopIds.value }))
  }

  function toggleRoute(routeId: string) {
    routeIds.value = routeSet.value.has(routeId)
      ? routeIds.value.filter((id) => id !== routeId)
      : [...routeIds.value, routeId]
    persist()
  }

  function toggleStop(stopId: string) {
    stopIds.value = stopSet.value.has(stopId)
      ? stopIds.value.filter((id) => id !== stopId)
      : [...stopIds.value, stopId]
    persist()
  }

  return { routeIds, stopIds, routeSet, stopSet, toggleRoute, toggleStop }
})
