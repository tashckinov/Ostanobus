<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { api } from '../api'

const events = ref<Array<Record<string, string>>>([])
onMounted(async () => {
  events.value = await api.events()
})

const routesHistory = computed(() => {
  const arrivals = events.value.filter((e) => e.type === 'bus_arrival')
  const grouped: Record<string, string[]> = {}
  
  for (const event of arrivals) {
    const routeId = event.routeId
    if (!routeId) continue
    const time = event.receivedAt ? new Date(event.receivedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''
    if (!time) continue
    if (!grouped[routeId]) {
      grouped[routeId] = []
    }
    grouped[routeId].push(time)
  }
  
  const entries = Object.entries(grouped)
  entries.sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
  
  return entries.map(([routeId, times]) => ({ routeId, times }))
})
</script>

<template>
  <section>
    <header class="page-header"><h1>История по маршрутам</h1></header>
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
            <div v-for="(time, i) in route.times" :key="i" style="font-family: monospace; font-size: 14px; color: #38424c; padding: 4px 8px; background: #f9fafb; border-radius: 4px;">
              {{ time }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
