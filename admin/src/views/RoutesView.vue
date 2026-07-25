<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { api } from '../api'
import TransitMap from '../components/TransitMap.vue'
import type { Route, RoutingPoint, Stop } from '../types'

const routes = ref<Route[]>([])
const stops = ref<Stop[]>([])
const edited = ref<Route | null>(null)
const directionIndex = ref(0)
const pointMode = ref<'stop' | 'via'>('stop')
const saving = ref(false)
const routing = ref(false)
const message = ref('')

const direction = computed(() => edited.value?.directions[directionIndex.value] ?? null)
const stopById = computed(() => new Map(stops.value.map((stop) => [stop.id, stop])))
const viaPoints = computed(() =>
  (direction.value?.routingPoints ?? [])
    .filter((point): point is Extract<RoutingPoint, { type: 'via' }> => point.type === 'via')
    .map((point) => ({ longitude: point.longitude, latitude: point.latitude })),
)

function cloneRoute(route: Route) {
  edited.value = structuredClone(route)
  directionIndex.value = 0
  message.value = ''
}

function createRoute() {
  edited.value = {
    routeId: '',
    cityId: 'volgodonsk',
    number: '',
    name: null,
    color: '#0074dc',
    active: true,
    isMock: false,
    directions: [
      {
        id: '',
        name: '',
        terminal: '',
        stopIds: [],
        routingPoints: [],
        geometry: null,
        distanceMeters: null,
        active: true,
      },
    ],
  }
  directionIndex.value = 0
}

function addDirection() {
  if (!edited.value) return
  edited.value.directions.push({
    id: '',
    name: '',
    terminal: '',
    stopIds: [],
    routingPoints: [],
    geometry: null,
    distanceMeters: null,
    active: true,
  })
  directionIndex.value = edited.value.directions.length - 1
}

function removeDirection() {
  if (!edited.value || edited.value.directions.length <= 1) return
  edited.value.directions.splice(directionIndex.value, 1)
  directionIndex.value = Math.max(0, directionIndex.value - 1)
}

function rebuildStopIds() {
  if (!direction.value) return
  direction.value.stopIds = direction.value.routingPoints
    .filter((point): point is Extract<RoutingPoint, { type: 'stop' }> => point.type === 'stop')
    .map((point) => point.stopId)
  direction.value.geometry = null
  direction.value.distanceMeters = null
}

function addStop(stop: Stop) {
  if (!direction.value || pointMode.value !== 'stop') return
  if (direction.value.stopIds.includes(stop.id)) {
    message.value = 'Эта остановка уже добавлена в направление'
    return
  }
  direction.value.routingPoints.push({ type: 'stop', stopId: stop.id })
  rebuildStopIds()
}

function addVia(longitude: number, latitude: number) {
  if (!direction.value || pointMode.value !== 'via') return
  direction.value.routingPoints.push({ type: 'via', longitude, latitude })
  rebuildStopIds()
}

function pointName(point: RoutingPoint) {
  return point.type === 'stop'
    ? (stopById.value.get(point.stopId)?.name ?? point.stopId)
    : 'Точка коррекции'
}

function movePoint(index: number, delta: number) {
  if (!direction.value) return
  const next = index + delta
  if (next < 0 || next >= direction.value.routingPoints.length) return
  const points = direction.value.routingPoints
  const current = points[index]
  const target = points[next]
  if (!current || !target) return
  points[index] = target
  points[next] = current
  rebuildStopIds()
}

function removePoint(index: number) {
  direction.value?.routingPoints.splice(index, 1)
  rebuildStopIds()
}

async function buildGeometry() {
  if (!direction.value) return
  const coordinates = direction.value.routingPoints
    .map((point) => {
      if (point.type === 'via') return [point.longitude, point.latitude]
      const stop = stopById.value.get(point.stopId)
      return stop ? [stop.longitude, stop.latitude] : null
    })
    .filter((point): point is number[] => Boolean(point))
  if (coordinates.length < 2) {
    message.value = 'Добавьте минимум две точки'
    return
  }
  routing.value = true
  try {
    const result = await api.buildGeometry(coordinates)
    direction.value.geometry = result.geometry
    direction.value.distanceMeters = result.distanceMeters
    message.value = `Трасса построена: ${(result.distanceMeters / 1000).toFixed(1)} км`
  } finally {
    routing.value = false
  }
}

async function save() {
  if (!edited.value) return
  if (!edited.value.routeId || !edited.value.number) {
    message.value = 'Заполните ID и номер маршрута'
    return
  }
  for (const item of edited.value.directions) {
    if (!item.id || !item.name || !item.terminal || item.stopIds.length < 2) {
      message.value = 'Заполните направление и добавьте минимум две остановки'
      return
    }
  }
  saving.value = true
  try {
    await api.saveRoute(edited.value)
    await load()
    const saved = routes.value.find((route) => route.routeId === edited.value?.routeId)
    if (saved) cloneRoute(saved)
    message.value = 'Маршрут сохранён'
  } finally {
    saving.value = false
  }
}

async function removeRoute() {
  if (!edited.value || !confirm(`Удалить маршрут ${edited.value.number}?`)) return
  await api.deleteRoute(edited.value.routeId)
  await load()
  edited.value = routes.value[0] ? structuredClone(routes.value[0]) : null
}

async function load() {
  ;[routes.value, stops.value] = await Promise.all([api.routes(), api.stops()])
  if (!edited.value && routes.value[0]) cloneRoute(routes.value[0])
}

onMounted(load)
</script>

<template>
  <section class="editor-page">
    <header class="page-header toolbar">
      <div>
        <h1>Маршруты</h1>
        <p>Остановки и точки коррекции добавляются в текущем порядке.</p>
      </div>
      <div class="toolbar-actions">
        <select
          :value="edited?.routeId"
          @change="
            cloneRoute(
              routes.find((route) => route.routeId === ($event.target as HTMLSelectElement).value)!,
            )
          "
        >
          <option v-for="route in routes" :key="route.routeId" :value="route.routeId">
            № {{ route.number }}
          </option>
        </select>
        <button class="secondary" @click="createRoute">Новый маршрут</button>
      </div>
    </header>

    <div v-if="edited && direction" class="editor-grid route-editor">
      <TransitMap
        :stops="stops"
        :geometry="direction.geometry"
        :routing-points="viaPoints"
        @stop-click="addStop"
        @map-click="addVia"
      />

      <aside class="panel route-panel">
        <div class="row">
          <label
            >ID<input
              v-model="edited.routeId"
              :disabled="routes.some((r) => r.routeId === edited?.routeId)"
          /></label>
          <label>Номер<input v-model="edited.number" /></label>
        </div>
        <label>Название<input v-model="edited.name" /></label>
        <div class="row">
          <label>Цвет<input v-model="edited.color" type="color" /></label>
          <label class="check"><input v-model="edited.active" type="checkbox" /> Активен</label>
        </div>

        <div class="section-title">
          <strong>Направление</strong>
          <div>
            <button
              v-for="(_, index) in edited.directions"
              :key="index"
              class="tab"
              :class="{ active: index === directionIndex }"
              @click="directionIndex = index"
            >
              {{ index + 1 }}
            </button>
            <button class="tab" @click="addDirection">+</button>
          </div>
        </div>

        <div class="row">
          <label>ID<input v-model="direction.id" /></label>
          <label>Конечная<input v-model="direction.terminal" /></label>
        </div>
        <label>Название направления<input v-model="direction.name" /></label>

        <div class="mode-switch">
          <button :class="{ active: pointMode === 'stop' }" @click="pointMode = 'stop'">
            Добавлять остановки
          </button>
          <button :class="{ active: pointMode === 'via' }" @click="pointMode = 'via'">
            Точки коррекции
          </button>
        </div>

        <ol class="waypoints">
          <li v-for="(point, index) in direction.routingPoints" :key="index">
            <span :class="point.type">{{ point.type === 'stop' ? index + 1 : '•' }}</span>
            <strong>{{ pointName(point) }}</strong>
            <button title="Выше" @click="movePoint(index, -1)">↑</button>
            <button title="Ниже" @click="movePoint(index, 1)">↓</button>
            <button title="Удалить" @click="removePoint(index)">×</button>
          </li>
        </ol>

        <p v-if="message" class="notice">{{ message }}</p>
        <div class="actions">
          <button :disabled="routing" @click="buildGeometry">
            {{ routing ? 'Прокладываем…' : 'Проложить по дорогам' }}
          </button>
          <button :disabled="saving" @click="save">Сохранить</button>
          <button
            class="secondary"
            :disabled="edited.directions.length <= 1"
            @click="removeDirection"
          >
            Удалить направление
          </button>
          <button class="danger" @click="removeRoute">Удалить маршрут</button>
        </div>
      </aside>
    </div>
  </section>
</template>
