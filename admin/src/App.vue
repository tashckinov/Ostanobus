<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { getToken, setToken } from './api'
import DashboardView from './views/DashboardView.vue'
import EventsView from './views/EventsView.vue'
import ForecastsView from './views/ForecastsView.vue'
import HistoryView from './views/HistoryView.vue'
import LoginView from './views/LoginView.vue'
import StopwiseRouteImportView from './views/StopwiseRouteImportViewV2.vue'
import RoutesView from './views/RoutesView.vue'
import StopsView from './views/StopsView.vue'
import SupportView from './views/SupportView.vue'

type Page =
  | 'dashboard'
  | 'stops'
  | 'routes'
  | 'route-import'
  | 'forecasts'
  | 'events'
  | 'history'
  | 'support'

const authenticated = ref(Boolean(getToken()))
const pages: Array<{ id: Page; label: string }> = [
  { id: 'dashboard', label: 'Обзор' },
  { id: 'stops', label: 'Остановки' },
  { id: 'routes', label: 'Маршруты' },
  { id: 'route-import', label: 'Импорт маршрута' },
  { id: 'forecasts', label: 'Прогнозы' },
  { id: 'history', label: 'История' },
  { id: 'events', label: 'Отметки' },
  { id: 'support', label: 'Обращения' },
]
const initialPage = location.hash.slice(1)
const page = ref<Page>(
  initialPage === 'schedules'
    ? 'routes'
    : (pages.find((item) => item.id === initialPage)?.id ?? 'dashboard'),
)

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
  const requested = location.hash.slice(1)
  if (requested === 'schedules') {
    navigate('routes')
    return
  }
  const matched = pages.find((item) => item.id === requested)
  if (matched) page.value = matched.id
}
onMounted(() => {
  if (location.hash.slice(1) === 'schedules') location.hash = 'routes'
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
      <StopwiseRouteImportView v-else-if="page === 'route-import'" />
      <ForecastsView v-else-if="page === 'forecasts'" />
      <HistoryView v-else-if="page === 'history'" />
      <EventsView v-else-if="page === 'events'" />
      <SupportView v-else-if="page === 'support'" />
    </main>
  </div>
</template>
