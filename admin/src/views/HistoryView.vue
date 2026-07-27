<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import type { Route, Stop } from '../types'
import { api } from '../api'
import TransitMap from '../components/TransitMap.vue'

const events = ref<Array<Record<string, string>>>([])
const routes = ref<Route[]>([])
const stops = ref<Stop[]>([])

const selectedRouteId = ref<string | null>(null)
const selectedMapStopId = ref<string | null>(null)

const addingTime = ref(false)
const newTimeValue = ref('')

onMounted(async () => {
  const [fetchedEvents, fetchedRoutes, fetchedStops] = await Promise.all([
    api.events(),
    api.routes(),
    api.stops()
  ])
  events.value = fetchedEvents
  routes.value = fetchedRoutes
  stops.value = fetchedStops
})

const activeRoute = computed(() => {
  if (!selectedRouteId.value) return null
  return routes.value.find(r => r.routeId === selectedRouteId.value) || null
})

// Extract the selected route's directions for the map to display
const activeDirection = computed(() => activeRoute.value?.directions[0] ?? null)
const selectedStopIds = computed(() => activeDirection.value?.stopIds ?? [])
const previewCoordinates = computed(() => {
  if (!activeDirection.value) return []
  return activeDirection.value.routingPoints
    .filter(p => p.longitude !== undefined && p.latitude !== undefined)
    .map(p => [p.longitude!, p.latitude!])
})

const stopById = computed(() => new Map(stops.value.map(s => [s.id, s])))
const selectedMapStop = computed(() => selectedMapStopId.value ? stopById.value.get(selectedMapStopId.value) : null)

// Filter schedules for the selected route and stop
const schedule = computed(() => {
  if (!selectedRouteId.value || !selectedMapStopId.value) return []
  
  const arrivals = events.value.filter(
    (e) => (e.type === 'bus_arrival' || e.type === 'bus_missing') && e.routeId === selectedRouteId.value && e.stopId === selectedMapStopId.value
  )
  
  const times = arrivals.map(event => {
    return {
      id: event.id ?? '',
      type: event.type,
      time: event.receivedAt ? new Date(event.receivedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''
    }
  }).filter(t => t.time)
  
  return times.sort((a, b) => b.time.localeCompare(a.time))
})

async function deleteEvent(id: string) {
  if (!confirm('Удалить эту отметку?')) return
  await api.deleteEvent(id)
  events.value = events.value.filter((e) => e.id !== id)
}

async function addManualEvent(type: 'bus_arrival' | 'bus_missing') {
  if (!selectedRouteId.value || !selectedMapStopId.value || !newTimeValue.value) return
  
  addingTime.value = true
  try {
    const today = new Date()
    const parts = newTimeValue.value.split(':').map(Number)
    const hours = parts[0] ?? 0
    const minutes = parts[1] ?? 0
    today.setHours(hours, minutes, 0, 0)
    
    const newEvent = await api.addEvent({
      type,
      routeId: selectedRouteId.value,
      stopId: selectedMapStopId.value,
      time: today.toISOString()
    })
    events.value = [newEvent, ...events.value]
    newTimeValue.value = ''
  } catch {
    alert('Не удалось добавить время')
  } finally {
    addingTime.value = false
  }
}

function selectRoute(route: Route) {
  selectedRouteId.value = route.routeId
  selectedMapStopId.value = null
}
</script>

<template>
  <section class="editor-page">
    <header class="page-header">
      <div>
        <h1>История по маршрутам</h1>
        <p>
          {{
            selectedRouteId
              ? 'Выберите остановку на карте для просмотра расписания.'
              : 'Выберите маршрут в списке.'
          }}
        </p>
      </div>
    </header>

    <div class="routes-workspace editing">
      <!-- Левая панель: выбор маршрута -->
      <aside class="panel route-properties-panel" style="width: 280px; overflow-y: auto;">
        <div class="route-list-heading" style="padding: 16px;">
          <strong>Маршруты</strong>
        </div>
        <div class="route-list" style="display: flex; flex-direction: column; gap: 8px; padding: 0 16px 16px;">
          <button 
            v-for="route in routes" 
            :key="route.routeId" 
            style="display: flex; align-items: center; gap: 12px; padding: 8px; background: #fff; border: 1px solid #d8dde2; border-radius: 6px; cursor: pointer; text-align: left;"
            :style="selectedRouteId === route.routeId ? 'border-color: #0074dc; background: #f0f7ff;' : ''"
            @click="selectRoute(route)"
          >
            <span class="route-number" :style="{ borderColor: route.color, background: route.color, color: '#fff', padding: '4px 8px', borderRadius: '4px', fontWeight: 'bold' }">
              {{ route.number }}
            </span>
            <span>
              <strong>
                {{ route.name || route.directions[0]?.name || `Маршрут № ${route.number}` }}
              </strong>
            </span>
          </button>
        </div>
      </aside>

      <!-- Центральная панель: карта -->
      <div class="map-container" style="flex: 1; min-width: 0;">
        <TransitMap
          :stops="stops"
          :selected-stop-id="selectedMapStopId"
          :selected-stop-ids="selectedStopIds"
          :preview-coordinates="previewCoordinates"
          @update:selected-stop-id="selectedMapStopId = $event"
        />
      </div>

      <!-- Правая панель: расписание остановки -->
      <aside v-if="selectedMapStopId && selectedMapStop" class="panel stop-schedule-panel" style="width: 350px; display: flex; flex-direction: column; padding: 16px; overflow-y: auto;">
        <h2 style="font-size: 16px; font-weight: 600; margin-bottom: 4px;">{{ selectedMapStop.name }}</h2>
        <p style="font-size: 13px; color: #6e7781; margin-bottom: 20px;">История прибытий</p>
        
        <div style="background: #f9fafb; border: 1px solid #d8dde2; border-radius: 6px; padding: 12px; margin-bottom: 16px;">
          <label style="display: block; font-size: 13px; font-weight: 500; margin-bottom: 8px;">Добавить вручную</label>
          <div style="display: flex; gap: 8px; align-items: center;">
            <input v-model="newTimeValue" type="time" style="padding: 6px; border: 1px solid #d8dde2; border-radius: 4px; font-size: 14px; width: 100px;" />
            <button :disabled="!newTimeValue || addingTime" style="background: #0074dc; color: #fff; border: none; border-radius: 4px; padding: 6px 10px; font-size: 13px; cursor: pointer; flex: 1;" @click="addManualEvent('bus_arrival')">Прибыл</button>
            <button :disabled="!newTimeValue || addingTime" style="background: #fff; color: #b42318; border: 1px solid #fca5a5; border-radius: 4px; padding: 6px 10px; font-size: 13px; cursor: pointer; flex: 1;" @click="addManualEvent('bus_missing')">Не было</button>
          </div>
        </div>

        <div v-if="!schedule.length" class="empty-state" style="padding: 20px; text-align: center; color: #6e7781; font-size: 14px; background: #fff; border-radius: 6px; border: 1px solid #eef0f2;">
          Нет отметок для этой остановки
        </div>
        
        <div v-else style="display: flex; flex-direction: column; gap: 6px;">
          <div v-for="record in schedule" :key="record.id" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: #fff; border-radius: 4px; border: 1px solid #eef0f2;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-family: monospace; font-size: 14px; font-weight: 500;">{{ record.time }}</span>
              <span v-if="record.type === 'bus_missing'" style="font-size: 11px; color: #b42318; background: #fee2e2; padding: 2px 6px; border-radius: 10px;">Автобуса нету</span>
            </div>
            <button style="background: none; border: none; color: #b42318; font-size: 16px; line-height: 1; cursor: pointer; padding: 0 4px;" title="Удалить" @click="deleteEvent(record.id)">&times;</button>
          </div>
        </div>
      </aside>
      <aside v-else-if="selectedRouteId" class="panel stop-schedule-panel" style="width: 350px; padding: 16px; text-align: center; color: #6e7781; display: flex; flex-direction: column; justify-content: center;">
        Выберите остановку на карте
      </aside>
    </div>
  </section>
</template>
