<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import type { Stop } from '../types'
import { api } from '../api'

const events = ref<Array<Record<string, string>>>([])
const stops = ref<Stop[]>([])
const selectedStopId = ref<string>('')

onMounted(async () => {
  const [fetchedEvents, fetchedStops] = await Promise.all([
    api.events(),
    api.stops()
  ])
  events.value = fetchedEvents
  stops.value = fetchedStops
})

const routesHistory = computed(() => {
  const arrivals = events.value.filter((e) => e.type === 'bus_arrival' && (!selectedStopId.value || e.stopId === selectedStopId.value))
  const grouped: Record<string, Array<{ id: string, time: string, stopId: string }>> = {}
  
  for (const event of arrivals) {
    const routeId = event.routeId
    if (!routeId) continue
    const time = event.receivedAt ? new Date(event.receivedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''
    if (!time) continue
    if (!grouped[routeId]) {
      grouped[routeId] = []
    }
    grouped[routeId].push({ id: event.id ?? '', time, stopId: event.stopId ?? '' })
  }
  
  const entries = Object.entries(grouped)
  entries.sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
  
  return entries.map(([routeId, times]) => ({ routeId, times }))
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
      <h1>История по маршрутам</h1>
      <select v-model="selectedStopId" style="padding: 6px; border-radius: 4px; border: 1px solid #d8dde2; font-size: 14px;">
        <option value="">Все остановки</option>
        <option v-for="stop in stops" :key="stop.id" :value="stop.id">{{ stop.name }}</option>
      </select>
    </header>
    <div style="padding: 22px;">
      <div v-if="!routesHistory.length" class="empty-state">Нет данных о прибытиях.</div>
      <div v-else style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px;">
        <div 
          v-for="route in routesHistory" 
          :key="route.routeId" 
          style="background: #fff; border: 1px solid #d8dde2; border-radius: 8px; padding: 16px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);"
        >
          <h2 style="margin: 0 0 12px 0; font-size: 16px; border-bottom: 1px solid #f4f6f8; padding-bottom: 8px; font-weight: 600;">
            Маршрут {{ route.routeId }}
          </h2>
          <div style="display: flex; flex-direction: column; gap: 4px; max-height: 400px; overflow-y: auto;">
            <div v-for="record in route.times" :key="record.id" style="display: flex; justify-content: space-between; align-items: center; font-family: monospace; font-size: 14px; color: #38424c; padding: 4px 8px; background: #f9fafb; border-radius: 4px;">
              <span>{{ record.time }}</span>
              <button style="background: none; border: none; color: #b42318; padding: 2px 6px; border-radius: 4px;" title="Удалить" @click="deleteEvent(record.id)">
                &times;
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
