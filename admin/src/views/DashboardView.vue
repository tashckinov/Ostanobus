<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { api } from '../api'

const data = ref<Awaited<ReturnType<typeof api.dashboard>> | null>(null)
onMounted(async () => {
  data.value = await api.dashboard()
})
</script>

<template>
  <section>
    <header class="page-header"><h1>Обзор</h1></header>
    <div v-if="data" class="metrics">
      <div>
        <strong>{{ data.stops }}</strong
        ><span>остановок</span>
      </div>
      <div>
        <strong>{{ data.routes }}</strong
        ><span>маршрутов</span>
      </div>
      <div>
        <strong>{{ data.events }}</strong
        ><span>отметок</span>
      </div>
      <div>
        <strong>{{ data.newTickets }}</strong
        ><span>новых обращений</span>
      </div>
    </div>
  </section>
</template>
