<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { api } from '../api'

const events = ref<Array<Record<string, string>>>([])
onMounted(async () => {
  events.value = await api.events()
})
</script>

<template>
  <section>
    <header class="page-header"><h1>Отметки пассажиров</h1></header>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Время</th>
            <th>Тип</th>
            <th>Маршрут</th>
            <th>Остановка</th>
            <th>Устройство</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="event in events" :key="event.id">
            <td>
              {{ event.receivedAt ? new Date(event.receivedAt).toLocaleString('ru-RU') : '—' }}
            </td>
            <td>{{ event.type === 'bus_arrival' ? 'Прибытие' : 'Прохождение' }}</td>
            <td>{{ event.routeId }}</td>
            <td>{{ event.stopId }}</td>
            <td class="mono">{{ event.clientId }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
