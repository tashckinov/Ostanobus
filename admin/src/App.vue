<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { getToken, setToken } from './api'
import DashboardView from './views/DashboardView.vue'
import EventsView from './views/EventsView.vue'
import ForecastsView from './views/ForecastsView.vue'
import LoginView from './views/LoginView.vue'
import RoutesView from './views/RoutesView.vue'
import SchedulesView from './views/SchedulesView.vue'
import StopsView from './views/StopsView.vue'
import SupportView from './views/SupportView.vue'

type Page = 'dashboard' | 'stops' | 'routes' | 'schedules' | 'forecasts' | 'events' | 'support'

const authenticated = ref(Boolean(getToken()))
const page = ref<Page>((location.hash.slice(1) as Page) || 'dashboard')
const pages: Array<{ id: Page; label: string }> = [
  { id: 'dashboard', label: 'Обзор' },
  { id: 'stops', label: 'Остановки' },
  { id: 'routes', label: 'Маршруты' },
  { id: 'schedules', label: 'Расписание' },
  { id: 'forecasts', label: 'Прогнозы' },
  { id: 'events', label: 'Отметки' },
  { id: 'support', label: 'Обращения' },
]

function navigate(next: Page) {
  page.value = next
  location.hash = next
}

function logout() {
  setToken(null)
  authenticated.value = false
}

const unauthorized = () => {
  authenticated.value = false
}
const hashChanged = () => {
  const requested = location.hash.slice(1) as Page
  if (pages.some((item) => item.id === requested)) page.value = requested
}
onMounted(() => {
  window.addEventListener('admin-unauthorized', unauthorized)
  window.addEventListener('hashchange', hashChanged)
})
onBeforeUnmount(() => {
  window.removeEventListener('admin-unauthorized', unauthorized)
  window.removeEventListener('hashchange', hashChanged)
})
</script>

<template>
  <LoginView v-if="!authenticated" @authenticated="authenticated = true" />
  <div v-else class="shell">
    <aside class="sidebar">
      <div class="brand">Останобус <small>Управление</small></div>
      <nav>
        <button
          v-for="item in pages"
          :key="item.id"
          :class="{ active: page === item.id }"
          @click="navigate(item.id)"
        >
          {{ item.label }}
        </button>
      </nav>
      <button class="logout" @click="logout">Выйти</button>
    </aside>
    <main class="workspace">
      <DashboardView v-if="page === 'dashboard'" />
      <StopsView v-else-if="page === 'stops'" />
      <RoutesView v-else-if="page === 'routes'" />
      <SchedulesView v-else-if="page === 'schedules'" />
      <ForecastsView v-else-if="page === 'forecasts'" />
      <EventsView v-else-if="page === 'events'" />
      <SupportView v-else-if="page === 'support'" />
    </main>
  </div>
</template>
