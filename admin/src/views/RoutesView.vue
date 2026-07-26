<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { api } from '../api'
import TransitMap from '../components/TransitMap.vue'
import type { Direction, Route, RoutingPoint, Stop } from '../types'

const routes = ref<Route[]>([])
const stops = ref<Stop[]>([])
const edited = ref<Route | null>(null)
const directionIndex = ref(0)
const pointMode = ref<'stop' | 'via'>('stop')
const saving = ref(false)
const routing = ref(false)
const loading = ref(true)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const dragIndex = ref<number | null>(null)

const direction = computed(() => edited.value?.directions[directionIndex.value] ?? null)
const stopById = computed(() => new Map(stops.value.map((stop) => [stop.id, stop])))
const isExistingRoute = computed(() =>
  routes.value.some((route) => route.routeId === edited.value?.routeId),
)
const viaPoints = computed(() =>
  (direction.value?.routingPoints ?? [])
    .filter((point): point is Extract<RoutingPoint, { type: 'via' }> => point.type === 'via')
    .map((point) => ({ longitude: point.longitude, latitude: point.latitude })),
)
const selectedStopIds = computed(() => direction.value?.stopIds ?? [])
const previewCoordinates = computed(() =>
  (direction.value?.routingPoints ?? [])
    .map(routingPointCoordinate)
    .filter((point): point is number[] => Boolean(point)),
)

function generatedId(kind: 'route' | 'direction') {
  return `${kind}-${crypto.randomUUID()}`
}

function newDirection(): Direction {
  return {
    id: generatedId('direction'),
    name: '',
    terminal: '',
    stopIds: [],
    routingPoints: [],
    geometry: null,
    distanceMeters: null,
    active: true,
  }
}

function showMessage(text: string, type: 'success' | 'error' = 'success') {
  message.value = text
  messageType.value = type
}

function cloneRoute(route: Route) {
  const copy = JSON.parse(JSON.stringify(route)) as Route
  copy.directions = copy.directions.map((item) => ({
    ...item,
    routingPoints:
      item.routingPoints?.length > 0
        ? item.routingPoints
        : item.stopIds.map((stopId) => ({ type: 'stop' as const, stopId })),
  }))
  edited.value = copy
  directionIndex.value = 0
  pointMode.value = 'stop'
  message.value = ''
}

function createRoute() {
  edited.value = {
    routeId: generatedId('route'),
    cityId: 'volgodonsk',
    number: '',
    name: '',
    color: '#0074dc',
    active: true,
    isMock: false,
    directions: [newDirection()],
  }
  directionIndex.value = 0
  pointMode.value = 'stop'
  message.value = ''
}

function backToRoutes() {
  edited.value = null
  directionIndex.value = 0
  pointMode.value = 'stop'
  message.value = ''
}

function addDirection() {
  if (!edited.value) return
  edited.value.directions.push(newDirection())
  directionIndex.value = edited.value.directions.length - 1
  pointMode.value = 'stop'
}

function removeDirection() {
  if (!edited.value || edited.value.directions.length <= 1) return
  if (!confirm('Удалить это направление?')) return
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
    showMessage('Эта остановка уже есть в направлении', 'error')
    return
  }
  direction.value.routingPoints.push({ type: 'stop', stopId: stop.id })
  rebuildStopIds()
  message.value = ''
}

function routingPointCoordinate(point: RoutingPoint) {
  if (point.type === 'via') return [point.longitude, point.latitude]
  const stop = stopById.value.get(point.stopId)
  return stop ? [stop.longitude, stop.latitude] : null
}

function distanceToSegmentSquared(point: number[], segmentStart: number[], segmentEnd: number[]) {
  const x = point[0] ?? 0
  const y = point[1] ?? 0
  const startX = segmentStart[0] ?? 0
  const startY = segmentStart[1] ?? 0
  const deltaX = (segmentEnd[0] ?? 0) - startX
  const deltaY = (segmentEnd[1] ?? 0) - startY
  const lengthSquared = deltaX * deltaX + deltaY * deltaY
  const ratio =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((x - startX) * deltaX + (y - startY) * deltaY) / lengthSquared))
  const nearestX = startX + ratio * deltaX
  const nearestY = startY + ratio * deltaY
  return (x - nearestX) ** 2 + (y - nearestY) ** 2
}

function addVia(longitude: number, latitude: number) {
  if (!direction.value || pointMode.value !== 'via') return
  const points = direction.value.routingPoints
  const coordinates = points.map(routingPointCoordinate)
  let insertAt = points.length
  let nearestDistance = Number.POSITIVE_INFINITY

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const start = coordinates[index]
    const end = coordinates[index + 1]
    if (!start || !end) continue
    const distance = distanceToSegmentSquared([longitude, latitude], start, end)
    if (distance < nearestDistance) {
      nearestDistance = distance
      insertAt = index + 1
    }
  }

  points.splice(insertAt, 0, { type: 'via', longitude, latitude })
  rebuildStopIds()
  showMessage('Точка коррекции вставлена в ближайший участок маршрута')
}

function pointName(point: RoutingPoint) {
  return point.type === 'stop'
    ? (stopById.value.get(point.stopId)?.name ?? 'Неизвестная остановка')
    : 'Точка коррекции трассы'
}

function pointOrder(index: number) {
  return direction.value?.routingPoints.slice(0, index + 1).filter((point) => point.type === 'stop')
    .length
}

function movePoint(index: number, delta: number) {
  if (!direction.value) return
  const next = index + delta
  if (next < 0 || next >= direction.value.routingPoints.length) return
  const points = direction.value.routingPoints
  const [current] = points.splice(index, 1)
  if (!current) return
  points.splice(next, 0, current)
  rebuildStopIds()
}

function dropPoint(targetIndex: number) {
  if (!direction.value || dragIndex.value === null || dragIndex.value === targetIndex) return
  const [current] = direction.value.routingPoints.splice(dragIndex.value, 1)
  if (!current) return
  direction.value.routingPoints.splice(targetIndex, 0, current)
  dragIndex.value = null
  rebuildStopIds()
}

function removePoint(index: number) {
  direction.value?.routingPoints.splice(index, 1)
  rebuildStopIds()
}

function directionFallback(item: Direction) {
  const first = stopById.value.get(item.stopIds[0] ?? '')?.name
  const last = stopById.value.get(item.stopIds.at(-1) ?? '')?.name
  return {
    terminal: last ?? '',
    name: first && last ? `${first} → ${last}` : last ? `к ${last}` : '',
  }
}

async function buildGeometry() {
  if (!direction.value) return
  const coordinates = previewCoordinates.value

  if (coordinates.length < 2) {
    showMessage('Выберите на карте минимум две остановки', 'error')
    return
  }

  routing.value = true
  try {
    const result = await api.buildGeometry(coordinates)
    direction.value.geometry = result.geometry
    direction.value.distanceMeters = result.distanceMeters
    showMessage(`Трасса построена через все точки: ${(result.distanceMeters / 1000).toFixed(1)} км`)
  } catch (error) {
    showMessage(error instanceof Error ? error.message : 'Не удалось построить трассу', 'error')
  } finally {
    routing.value = false
  }
}

async function save() {
  if (!edited.value) return
  edited.value.number = edited.value.number.trim()
  if (!edited.value.number) {
    showMessage('Укажите номер маршрута', 'error')
    return
  }

  for (const item of edited.value.directions) {
    if (item.stopIds.length < 2) {
      showMessage('В каждом направлении должно быть минимум две остановки', 'error')
      return
    }
    const fallback = directionFallback(item)
    item.terminal = item.terminal.trim() || fallback.terminal
    item.name = item.name.trim() || fallback.name
  }

  saving.value = true
  try {
    await api.saveRoute(edited.value)
    const routeId = edited.value.routeId
    await load()
    const saved = routes.value.find((route) => route.routeId === routeId)
    if (saved) cloneRoute(saved)
    showMessage('Маршрут сохранён')
  } catch (error) {
    showMessage(error instanceof Error ? error.message : 'Не удалось сохранить маршрут', 'error')
  } finally {
    saving.value = false
  }
}

async function removeRoute() {
  if (!edited.value || !isExistingRoute.value) return
  if (!confirm(`Удалить маршрут № ${edited.value.number}?`)) return
  await api.deleteRoute(edited.value.routeId)
  await load()
  backToRoutes()
}

async function load() {
  loading.value = true
  try {
    ;[routes.value, stops.value] = await Promise.all([api.routes(), api.stops()])
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="editor-page">
    <header class="page-header">
      <div>
        <h1>Маршруты</h1>
        <p>
          {{
            edited
              ? 'Настройте маршрут и порядок движения.'
              : 'Выберите маршрут на карте или в списке.'
          }}
        </p>
      </div>
      <button v-if="!edited" @click="createRoute">Создать маршрут</button>
    </header>

    <div class="routes-workspace" :class="{ editing: edited }">
      <aside v-if="!edited" class="route-list-panel">
        <div class="route-list-heading">
          <strong>Маршруты</strong>
          <span>{{ routes.length }}</span>
        </div>
        <div v-if="loading" class="empty-state compact">Загрузка…</div>
        <div v-else-if="routes.length" class="route-list">
          <button v-for="route in routes" :key="route.routeId" @click="cloneRoute(route)">
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
            <span>Маршруты</span>
            <strong>{{ edited.number ? `Маршрут № ${edited.number}` : 'Новый маршрут' }}</strong>
          </div>
        </div>

        <label class="switch-control">
          <input v-model="edited.active" type="checkbox" />
          <span>{{ edited.active ? 'Маршрут включён' : 'Маршрут выключен' }}</span>
        </label>

        <div class="route-main-fields">
          <label>
            Номер
            <input v-model="edited.number" placeholder="Например, 3К" />
          </label>
          <label class="color-field">
            Цвет
            <input v-model="edited.color" type="color" title="Цвет линии маршрута" />
          </label>
        </div>
        <label>
          Название
          <input v-model="edited.name" placeholder="Например, «ВЗМЭО — Артемида»" />
        </label>

        <div class="direction-header">
          <strong>Направления</strong>
          <button class="secondary small-button" @click="addDirection">Добавить</button>
        </div>
        <div class="direction-tabs">
          <button
            v-for="(item, index) in edited.directions"
            :key="item.id"
            class="direction-tab"
            :class="{ active: index === directionIndex }"
            @click="directionIndex = index"
          >
            <strong>{{ index + 1 }}</strong>
            <span>{{ item.terminal || `Направление ${index + 1}` }}</span>
          </button>
        </div>

        <template v-if="direction">
          <label>
            Конечная
            <input v-model="direction.terminal" placeholder="По последней остановке" />
          </label>
          <label>
            Название направления
            <input v-model="direction.name" placeholder="Заполнится автоматически" />
          </label>
          <label class="switch-control">
            <input v-model="direction.active" type="checkbox" />
            <span>Направление активно</span>
          </label>

          <div class="mode-switch vertical">
            <button :class="{ active: pointMode === 'stop' }" @click="pointMode = 'stop'">
              Выбирать остановки
            </button>
            <button :class="{ active: pointMode === 'via' }" @click="pointMode = 'via'">
              Добавлять точки коррекции
            </button>
          </div>
        </template>

        <button v-if="edited.directions.length > 1" class="text-danger" @click="removeDirection">
          Удалить направление
        </button>
        <button v-if="isExistingRoute" class="text-danger" @click="removeRoute">
          Удалить маршрут
        </button>
      </aside>

      <div class="map-stage">
        <TransitMap
          :stops="stops"
          :geometry="direction?.geometry"
          :routing-points="viaPoints"
          :preview-coordinates="previewCoordinates"
          :selected-stop-ids="selectedStopIds"
          :route-color="edited?.color"
          @stop-click="addStop"
          @map-click="addVia"
        />
        <div v-if="edited" class="map-hint">
          {{
            pointMode === 'stop'
              ? 'Нажимайте на остановки в порядке движения'
              : 'Нажмите возле нужного участка — точка вставится между ближайшими остановками'
          }}
        </div>
      </div>

      <aside v-if="edited && direction" class="panel route-order-panel">
        <div class="route-order-heading">
          <div>
            <span>Направление {{ directionIndex + 1 }}</span>
            <strong>Порядок движения</strong>
          </div>
          <span>{{ direction.stopIds.length }} остановок</span>
        </div>

        <ol v-if="direction.routingPoints.length" class="waypoints route-waypoints">
          <li
            v-for="(point, index) in direction.routingPoints"
            :key="`${point.type}-${index}`"
            draggable="true"
            @dragstart="dragIndex = index"
            @dragend="dragIndex = null"
            @dragover.prevent
            @drop="dropPoint(index)"
          >
            <span class="drag-handle" title="Перетащить">⋮⋮</span>
            <span :class="point.type">{{ point.type === 'stop' ? pointOrder(index) : '•' }}</span>
            <strong>{{ pointName(point) }}</strong>
            <button title="Выше" @click="movePoint(index, -1)">↑</button>
            <button title="Ниже" @click="movePoint(index, 1)">↓</button>
            <button title="Удалить" @click="removePoint(index)">×</button>
          </li>
        </ol>
        <div v-else class="empty-state">
          Выберите первую остановку на карте, затем остальные по порядку.
        </div>

        <p v-if="message" class="notice" :class="{ error: messageType === 'error' }">
          {{ message }}
        </p>

        <div class="route-actions">
          <button class="secondary" :disabled="routing" @click="buildGeometry">
            {{ routing ? 'Прокладываем…' : 'Проложить по дорогам' }}
          </button>
          <button :disabled="saving" @click="save">
            {{ saving ? 'Сохраняем…' : 'Сохранить маршрут' }}
          </button>
        </div>
      </aside>
    </div>
  </section>
</template>
