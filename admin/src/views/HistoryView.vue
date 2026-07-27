<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import type { Stop } from '../types'
import { api } from '../api'

const events = ref<Array<Record<string, string>>>([])
const stops = ref<Stop[]>([])

const selectedRouteId = ref<string>('')
const selectedStopId = ref<string>('')

onMounted(async () => {
  const [fetchedEvents, fetchedStops] = await Promise.all([
    api.events(),
    api.stops()
  ])
  events.value = fetchedEvents
  stops.value = fetchedStops
})

const availableRoutes = computed(() => {
  const arrivals = events.value.filter((e) => e.type === 'bus_arrival')
  const routes = new Set<string>()
  for (const e of arrivals) {
    if (e.routeId) routes.add(e.routeId)
  }
  return Array.from(routes).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
})

const availableStops = computed(() => {
  if (!selectedRouteId.value) return []
  const arrivals = events.value.filter((e) => e.type === 'bus_arrival' && e.routeId === selectedRouteId.value)
  const stopIds = new Set<string>()
  for (const e of arrivals) {
    if (e.stopId) stopIds.add(e.stopId)
  }
  
  return stops.value
    .filter(s => stopIds.has(s.id))
    .sort((a, b) => a.name.localeCompare(b.name))
})

function onRouteSelected() {
  if (selectedStopId.value && !availableStops.value.find(s => s.id === selectedStopId.value)) {
    selectedStopId.value = ''
  }
}

const schedule = computed(() => {
  if (!selectedRouteId.value || !selectedStopId.value) return []
  
  const arrivals = events.value.filter(
    (e) => e.type === 'bus_arrival' && e.routeId === selectedRouteId.value && e.stopId === selectedStopId.value
  )
  
  const times = arrivals.map(event => {
    return {
      id: event.id ?? '',
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
</script>

<template>
  <section>
    <header class="page-header" style="flex-wrap: wrap;">
      <h1>История прибытий</h1>
    </header>
    <div style="padding: 22px;">
      <div style="display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap;">
        <select 
          v-model="selectedRouteId" 
          style="padding: 8px 12px; border-radius: 6px; border: 1px solid #d8dde2; font-size: 14px; min-width: 150px; background: #fff;"
          @change="onRouteSelected"
        >
          <option value="">Выберите маршрут...</option>
          <option v-for="route in availableRoutes" :key="route" :value="route">Маршрут {{ route }}</option>
        </select>
        
        <select 
          v-model="selectedStopId" 
          :disabled="!selectedRouteId"
          style="padding: 8px 12px; border-radius: 6px; border: 1px solid #d8dde2; font-size: 14px; min-width: 250px; background: #fff;"
        >
          <option value="">Выберите остановку...</option>
          <option v-for="stop in availableStops" :key="stop.id" :value="stop.id">{{ stop.name }}</option>
        </select>
      </div>

      <div v-if="!selectedRouteId || !selectedStopId" class="empty-state">
        Пожалуйста, выберите маршрут и остановку для просмотра расписания.
      </div>
      <div v-else-if="!schedule.length" class="empty-state">
        Нет данных о прибытиях для выбранного маршрута и остановки.
      </div>
      <div v-else style="background: #fff; border: 1px solid #d8dde2; border-radius: 8px; padding: 16px; max-width: 400px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
        <h2 style="margin: 0 0 12px 0; font-size: 16px; border-bottom: 1px solid #f4f6f8; padding-bottom: 8px; font-weight: 600;">
          Отметки о прибытии
        </h2>
        <div style="display: flex; flex-direction: column; gap: 8px; max-height: 500px; overflow-y: auto;">
          <div v-for="record in schedule" :key="record.id" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: #f9fafb; border-radius: 6px; border: 1px solid #eef0f2;">
            <span style="font-family: monospace; font-size: 15px; font-weight: 500; color: #18212b;">{{ record.time }}</span>
            <button style="background: #fee2e2; border: 1px solid #fca5a5; color: #b91c1c; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500;" title="Удалить" @click="deleteEvent(record.id)">
              Удалить
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
