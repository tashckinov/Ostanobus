<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { api } from '../api'
import TransitMap from '../components/TransitMap.vue'
import type { Route, Stop } from '../types'

const routes = ref<Route[]>([])
const stops = ref<Stop[]>([])
const events = ref<Array<Record<string, string>>>([])

const selectedRoute = ref<Route | null>(null)
const directionIndex = ref(0)
const selectedMapStopId = ref<string | null>(null)
const loading = ref(true)

const newTimeValue = ref('')
const addingTime = ref(false)

const direction = computed(() => selectedRoute.value?.directions[directionIndex.value] ?? null)
const stopById = computed(() => new Map(stops.value.map((stop) => [stop.id, stop])))
const selectedMapStop = computed(() =>
  selectedMapStopId.value ? (stopById.value.get(selectedMapStopId.value) ?? null) : null,
)
const selectedStopIds = computed(() => direction.value?.stopIds ?? [])

function selectRoute(route: Route) {
  selectedRoute.value = JSON.parse(JSON.stringify(route)) as Route
  directionIndex.value = 0
  selectedMapStopId.value = null
}

function backToRoutes() {
  selectedRoute.value = null
  directionIndex.value = 0
  selectedMapStopId.value = null
}

function selectMapStop(stop: Stop) {
  selectedMapStopId.value = stop.id
}

const schedule = computed(() => {
  if (!selectedRoute.value || !selectedMapStopId.value) return []

  return events.value
    .filter(
      (event) =>
        (event.type === 'bus_arrival' || event.type === 'bus_missing') &&
        event.routeId === selectedRoute.value!.routeId &&
        event.stopId === selectedMapStopId.value,
    )
    .map((event) => ({
      id: event.id ?? '',
      type: event.type ?? '',
      time: event.receivedAt
        ? new Date(event.receivedAt).toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit',
          })
        : '',
      date: event.receivedAt
        ? new Date(event.receivedAt).toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
          })
        : '',
    }))
    .filter((record) => record.time)
})

async function deleteEvent(id: string) {
  if (!confirm('Удалить эту отметку?')) return
  await api.deleteEvent(id)
  events.value = events.value.filter((event) => event.id !== id)
}

async function addManualEvent(type: 'bus_arrival' | 'bus_missing') {
  if (!selectedRoute.value || !selectedMapStopId.value || !newTimeValue.value) return

  addingTime.value = true
  try {
    const today = new Date()
    const parts = newTimeValue.value.split(':').map(Number)
    today.setHours(parts[0] ?? 0, parts[1] ?? 0, 0, 0)

    const newEvent = await api.addEvent({
      type,
      routeId: selectedRoute.value.routeId,
      stopId: selectedMapStopId.value,
      time: today.toISOString(),
    })
    events.value = [newEvent, ...events.value]
    newTimeValue.value = ''
  } catch {
    alert('Не удалось добавить время')
  } finally {
    addingTime.value = false
  }
}

async function load() {
  loading.value = true
  try {
    ;[routes.value, stops.value, events.value] = await Promise.all([
      api.routes(),
      api.stops(),
      api.events(),
    ])
  } finally {
    loading.value = false
  }
}

watch(
  () => selectedRoute.value?.routeId,
  () => {
    selectedMapStopId.value = null
  },
)

onMounted(load)
</script>

<template>
  <section class="editor-page">
    <header class="page-header">
      <div>
        <h1>История по маршрутам</h1>
        <p>
          {{
            selectedRoute
              ? 'Выберите остановку на карте для просмотра истории.'
              : 'Выберите маршрут в списке.'
          }}
        </p>
      </div>
    </header>

    <div class="routes-workspace" :class="{ editing: selectedRoute }">
      <aside v-if="!selectedRoute" class="route-list-panel">
        <div class="route-list-heading">
          <strong>Маршруты</strong>
          <span>{{ routes.length }}</span>
        </div>
        <div v-if="loading" class="empty-state compact">Загрузка…</div>
        <div v-else-if="routes.length" class="route-list">
          <button v-for="route in routes" :key="route.routeId" @click="selectRoute(route)">
            <span class="route-number" :style="{ borderColor: route.color }">
              {{ route.number }}
            </span>
            <span class="route-list-copy">
              <strong>
                {{ route.name || route.directions[0]?.name || `Маршрут № ${route.number}` }}
              </strong>
              <small>
                {{ route.directions.length }}
                {{
                  route.directions.length === 1
                    ? 'направление'
                    : route.directions.length < 5
                      ? 'направления'
                      : 'направлений'
                }}
              </small>
            </span>
            <span class="route-state" :class="{ off: !route.active }">
              {{ route.active ? 'Включён' : 'Выключен' }}
            </span>
          </button>
        </div>
        <div v-else class="empty-state compact">Маршрутов пока нет.</div>
      </aside>

      <aside v-else class="panel route-properties-panel">
        <div class="route-back-heading">
          <button class="back-button" title="Назад к маршрутам" @click="backToRoutes">←</button>
          <div>
            <span>История</span>
            <strong>Маршрут № {{ selectedRoute.number }}</strong>
          </div>
        </div>

        <div v-if="selectedRoute.directions.length > 1" class="direction-tabs">
          <button
            v-for="(item, index) in selectedRoute.directions"
            :key="item.id"
            class="direction-tab"
            :class="{ active: index === directionIndex }"
            @click="
              directionIndex = index
              selectedMapStopId = null
            "
          >
            <strong>{{ index + 1 }}</strong>
            <span>{{ item.terminal || `Направление ${index + 1}` }}</span>
          </button>
        </div>

        <div v-if="direction" class="route-order-heading history-stops-heading">
          <div>
            <span>Направление {{ directionIndex + 1 }}</span>
            <strong>Остановки</strong>
          </div>
          <span>{{ direction.stopIds.length }} ост.</span>
        </div>
        <ol v-if="direction?.stopIds.length" class="waypoints route-waypoints">
          <li
            v-for="(stopId, index) in direction.stopIds"
            :key="stopId"
            class="waypoint-card history-stop"
            :class="{ dragging: selectedMapStopId === stopId }"
            @click="selectedMapStopId = stopId"
          >
            <span class="stop">{{
              index === 0 ? 'A' : index === direction.stopIds.length - 1 ? 'B' : index + 1
            }}</span>
            <strong>{{ stopById.get(stopId)?.name ?? 'Неизвестная остановка' }}</strong>
          </li>
        </ol>
        <div v-else class="empty-state">Нет остановок в этом направлении.</div>
      </aside>

      <div class="map-stage">
        <TransitMap
          :stops="stops"
          :segments="direction?.segments"
          :road-anchors="direction?.roadAnchors"
          :selected-stop-id="selectedMapStopId"
          :selected-stop-ids="selectedStopIds"
          :route-color="selectedRoute?.color"
          @stop-click="selectMapStop"
        />
      </div>

      <aside v-if="selectedRoute && direction && selectedMapStop" class="panel route-order-panel">
        <div class="route-order-heading">
          <div>
            <span>Остановка</span>
            <strong>{{ selectedMapStop.name }}</strong>
          </div>
        </div>

        <div class="history-add-form">
          <label>Добавить вручную</label>
          <div class="history-add-row">
            <input v-model="newTimeValue" type="time" />
            <button :disabled="!newTimeValue || addingTime" @click="addManualEvent('bus_arrival')">
              Прибыл
            </button>
            <button
              class="text-danger"
              :disabled="!newTimeValue || addingTime"
              @click="addManualEvent('bus_missing')"
            >
              Не было
            </button>
          </div>
        </div>

        <div v-if="!schedule.length" class="empty-state">Нет отметок для этой остановки</div>

        <div v-else class="history-list">
          <div v-for="record in schedule" :key="record.id" class="history-row">
            <span class="history-date">{{ record.date }}</span>
            <span class="history-time">{{ record.time }}</span>
            <span v-if="record.type === 'bus_missing'" class="history-missing-badge">
              нет автобуса
            </span>
            <button class="remove-btn" title="Удалить" @click="deleteEvent(record.id)">×</button>
          </div>
        </div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.history-stops-heading {
  margin-top: 12px;
}
.history-stop {
  grid-template-columns: 25px minmax(0, 1fr);
  cursor: pointer;
}
.history-add-form {
  border-bottom: 1px solid var(--border-color, #d8dde2);
  background: var(--bg-subtle, #f6f8fa);
  padding: 12px 16px;
}
.history-add-form label {
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 500;
}
.history-add-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.history-add-row input[type='time'] {
  width: 96px;
  border: 1px solid var(--border-color, #d8dde2);
  border-radius: 4px;
  padding: 5px 8px;
  font-size: 14px;
}
.history-add-row button {
  border: 1px solid var(--border-color, #d8dde2);
  border-radius: 4px;
  background: var(--accent, #0074dc);
  padding: 5px 10px;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}
.history-add-row button.text-danger {
  border-color: #fca5a5;
  background: #fff;
  color: #b42318;
}
.history-add-row button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.history-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 16px;
}
.history-row {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--border-subtle, #eef0f2);
  border-radius: 4px;
  background: var(--bg-card, #fff);
  padding: 4px 8px;
  font-size: 14px;
}
.history-date {
  min-width: 40px;
  color: var(--text-secondary, #6e7781);
  font-size: 12px;
}
.history-time {
  min-width: 44px;
  font-family: monospace;
  font-weight: 500;
}
.history-missing-badge {
  padding: 1px 6px;
  border-radius: 10px;
  background: #fee2e2;
  color: #b42318;
  font-size: 11px;
  white-space: nowrap;
}
.history-row .remove-btn {
  margin-left: auto;
}
</style>
