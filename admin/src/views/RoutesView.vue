<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { api } from '../api'
import StopScheduleEditor from '../components/StopScheduleEditor.vue'
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
const dragOverIndex = ref<number | null>(null)
const selectedMapStopId = ref<string | null>(null)
const roadAnchorEditingStopId = ref<string | null>(null)
const rightPanelMode = ref<'order' | 'schedule'>('order')
let autoRouteTimer: ReturnType<typeof setTimeout> | null = null
let routeRequestVersion = 0

const direction = computed(() => edited.value?.directions[directionIndex.value] ?? null)
const stopById = computed(() => new Map(stops.value.map((stop) => [stop.id, stop])))
const selectedMapStop = computed(() =>
  selectedMapStopId.value ? (stopById.value.get(selectedMapStopId.value) ?? null) : null,
)
const selectedMapRoutingPoint = computed(() =>
  direction.value?.routingPoints.find(
    (point): point is Extract<RoutingPoint, { type: 'stop' }> =>
      point.type === 'stop' && point.stopId === selectedMapStopId.value,
  ),
)
const selectedMapStopIsInRoute = computed(() => Boolean(selectedMapRoutingPoint.value))
const activeRouteAnchor = computed(() => {
  const stop = selectedMapStop.value
  const point = selectedMapRoutingPoint.value
  if (!stop || !point || roadAnchorEditingStopId.value !== stop.id) return null
  return {
    stopId: stop.id,
    longitude: point.longitude ?? stop.longitude,
    latitude: point.latitude ?? stop.latitude,
  }
})
const selectedStopHasCustomAnchor = computed(
  () =>
    selectedMapRoutingPoint.value?.longitude !== undefined &&
    selectedMapRoutingPoint.value.latitude !== undefined,
)
const isExistingRoute = computed(() =>
  routes.value.some((route) => route.routeId === edited.value?.routeId),
)
const selectedStopCanEditSchedule = computed(() => {
  const route = routes.value.find((item) => item.routeId === edited.value?.routeId)
  const savedDirection = route?.directions.find((item) => item.id === direction.value?.id)
  return Boolean(
    selectedMapStop.value && savedDirection?.stopIds.includes(selectedMapStop.value.id),
  )
})
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

function cancelAutoRouting() {
  if (autoRouteTimer) clearTimeout(autoRouteTimer)
  autoRouteTimer = null
  routeRequestVersion += 1
  routing.value = false
}

function resetStopTools() {
  selectedMapStopId.value = null
  roadAnchorEditingStopId.value = null
  rightPanelMode.value = 'order'
}

function cloneRoute(route: Route) {
  cancelAutoRouting()
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
  resetStopTools()
  message.value = ''
}

function createRoute() {
  cancelAutoRouting()
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
  resetStopTools()
  message.value = ''
}

function backToRoutes() {
  cancelAutoRouting()
  edited.value = null
  directionIndex.value = 0
  pointMode.value = 'stop'
  resetStopTools()
  message.value = ''
}

function addDirection() {
  if (!edited.value) return
  cancelAutoRouting()
  edited.value.directions.push(newDirection())
  directionIndex.value = edited.value.directions.length - 1
  pointMode.value = 'stop'
  resetStopTools()
}

function removeDirection() {
  if (!edited.value || edited.value.directions.length <= 1) return
  if (!confirm('Удалить это направление?')) return
  cancelAutoRouting()
  edited.value.directions.splice(directionIndex.value, 1)
  directionIndex.value = Math.max(0, directionIndex.value - 1)
  resetStopTools()
}

function rebuildStopIds() {
  if (!direction.value) return
  direction.value.stopIds = direction.value.routingPoints
    .filter((point): point is Extract<RoutingPoint, { type: 'stop' }> => point.type === 'stop')
    .map((point) => point.stopId)
  if (direction.value.stopIds.length < 2) {
    direction.value.geometry = null
    direction.value.distanceMeters = null
  }
}

function selectMapStop(stop: Stop) {
  if (!direction.value) return
  selectedMapStopId.value = stop.id
  roadAnchorEditingStopId.value = null
  rightPanelMode.value = 'order'
}

function closeStopMenu() {
  selectedMapStopId.value = null
  roadAnchorEditingStopId.value = null
}

function nearestInsertIndex(longitude: number, latitude: number) {
  const points = direction.value?.routingPoints ?? []
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

  return insertAt
}

function addSelectedStop() {
  const stop = selectedMapStop.value
  if (!direction.value || !stop) return
  if (direction.value.stopIds.includes(stop.id)) {
    showMessage('Эта остановка уже есть в направлении', 'error')
    return
  }
  direction.value.routingPoints.push({ type: 'stop', stopId: stop.id })
  rebuildStopIds()
  scheduleGeometryBuild()
  showMessage(`Остановка «${stop.name}» добавлена в маршрут`)
}

function removeSelectedStop() {
  const stop = selectedMapStop.value
  if (!direction.value || !stop) return
  const index = direction.value.routingPoints.findIndex(
    (point) => point.type === 'stop' && point.stopId === stop.id,
  )
  if (index < 0) return
  direction.value.routingPoints.splice(index, 1)
  rebuildStopIds()
  scheduleGeometryBuild()
  resetStopTools()
  showMessage(`Остановка «${stop.name}» удалена из маршрута`)
}

function beginRoadAnchorEditing() {
  const stop = selectedMapStop.value
  const point = selectedMapRoutingPoint.value
  if (!stop || !point) return
  point.longitude ??= stop.longitude
  point.latitude ??= stop.latitude
  roadAnchorEditingStopId.value = stop.id
  rightPanelMode.value = 'order'
  showMessage('Перетащите синюю дорожную точку на нужную полосу')
}

function finishRoadAnchorEditing() {
  roadAnchorEditingStopId.value = null
  showMessage('Положение дорожной точки сохранится вместе с маршрутом')
}

function openScheduleEditor() {
  if (!selectedStopCanEditSchedule.value) {
    showMessage('Сначала сохраните маршрут с этой остановкой', 'error')
    return
  }
  roadAnchorEditingStopId.value = null
  rightPanelMode.value = 'schedule'
}

function closeScheduleEditor() {
  rightPanelMode.value = 'order'
}

function moveRouteAnchor(stopId: string, longitude: number, latitude: number) {
  const point = direction.value?.routingPoints.find(
    (item): item is Extract<RoutingPoint, { type: 'stop' }> =>
      item.type === 'stop' && item.stopId === stopId,
  )
  if (!point) return
  point.longitude = longitude
  point.latitude = latitude
  scheduleGeometryBuild()
  showMessage('Дорожная точка остановки перемещена, трасса перестраивается')
}

function resetRouteAnchor() {
  const point = selectedMapRoutingPoint.value
  if (!point) return
  delete point.longitude
  delete point.latitude
  roadAnchorEditingStopId.value = null
  scheduleGeometryBuild()
  showMessage('Дорожная точка возвращена к координатам остановки')
}

function changeDirection(index: number) {
  cancelAutoRouting()
  directionIndex.value = index
  resetStopTools()
}

function routingPointCoordinate(point: RoutingPoint) {
  if (point.type === 'via') return [point.longitude, point.latitude]
  if (point.longitude !== undefined && point.latitude !== undefined) {
    return [point.longitude, point.latitude]
  }
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
  const insertAt = nearestInsertIndex(longitude, latitude)
  points.splice(insertAt, 0, { type: 'via', longitude, latitude })
  rebuildStopIds()
  scheduleGeometryBuild()
  showMessage('Точка коррекции добавлена, трасса перестраивается')
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
  scheduleGeometryBuild()
}

function dropPoint(insertBeforeIndex: number) {
  if (!direction.value || dragIndex.value === null) return
  const from = dragIndex.value
  if (from === insertBeforeIndex || from + 1 === insertBeforeIndex) {
    dragIndex.value = null
    dragOverIndex.value = null
    return
  }
  const [current] = direction.value.routingPoints.splice(from, 1)
  if (!current) return
  const adjustedTarget = insertBeforeIndex > from ? insertBeforeIndex - 1 : insertBeforeIndex
  direction.value.routingPoints.splice(adjustedTarget, 0, current)
  dragIndex.value = null
  dragOverIndex.value = null
  rebuildStopIds()
  scheduleGeometryBuild()
}

function removePoint(index: number) {
  direction.value?.routingPoints.splice(index, 1)
  rebuildStopIds()
  scheduleGeometryBuild()
}

// ─── Pointer-based drag & drop ───────────────────────────────────────────────

let pointerDragCleanup: (() => void) | null = null

function startDrag(event: PointerEvent, index: number) {
  event.preventDefault()
  dragIndex.value = index
  dragOverIndex.value = null

  const onMove = (e: PointerEvent) => {
    const list = document.querySelector('.route-waypoints')
    if (!list) return
    const items = list.querySelectorAll<HTMLElement>('.waypoint-card')
    let insertAt = items.length // default: after last
    for (let i = 0; i < items.length; i++) {
      const rect = items[i]!.getBoundingClientRect()
      const mid = rect.top + rect.height / 2
      if (e.clientY < mid) {
        insertAt = i
        break
      }
    }
    dragOverIndex.value = insertAt
  }

  const onUp = (e: PointerEvent) => {
    if (dragOverIndex.value !== null) {
      dropPoint(dragOverIndex.value)
    } else {
      dragIndex.value = null
      dragOverIndex.value = null
    }
    cleanup()
  }

  const cleanup = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    pointerDragCleanup = null
  }

  pointerDragCleanup = cleanup
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

function directionFallback(item: Direction) {
  const first = stopById.value.get(item.stopIds[0] ?? '')?.name
  const last = stopById.value.get(item.stopIds.at(-1) ?? '')?.name
  return {
    terminal: last ?? '',
    name: first && last ? `${first} → ${last}` : last ? `к ${last}` : '',
  }
}

function scheduleGeometryBuild() {
  if (autoRouteTimer) clearTimeout(autoRouteTimer)
  routeRequestVersion += 1
  if (previewCoordinates.value.length < 2) return
  autoRouteTimer = setTimeout(() => {
    autoRouteTimer = null
    void buildGeometry(true)
  }, 350)
}

async function buildGeometry(automatic = false) {
  if (!direction.value) return
  if (!automatic && autoRouteTimer) {
    clearTimeout(autoRouteTimer)
    autoRouteTimer = null
  }
  const coordinates = previewCoordinates.value

  if (coordinates.length < 2) {
    if (!automatic) showMessage('Выберите на карте минимум две остановки', 'error')
    return
  }

  const editedDirection = direction.value
  const requestVersion = ++routeRequestVersion
  routing.value = true
  try {
    const result = await api.buildGeometry(coordinates)
    if (requestVersion !== routeRequestVersion || direction.value?.id !== editedDirection.id) return
    editedDirection.geometry = result.geometry
    editedDirection.distanceMeters = result.distanceMeters
    showMessage(`Трасса построена через все точки: ${(result.distanceMeters / 1000).toFixed(1)} км`)
  } catch (error) {
    if (requestVersion === routeRequestVersion) {
      showMessage(error instanceof Error ? error.message : 'Не удалось построить трассу', 'error')
    }
  } finally {
    if (requestVersion === routeRequestVersion) routing.value = false
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
onBeforeUnmount(() => {
  if (autoRouteTimer) clearTimeout(autoRouteTimer)
})
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

        <label>
          Номер
          <input v-model="edited.number" placeholder="Например, 3К" />
        </label>
        <label class="color-field">
          Цвет
          <div class="color-picker-wrapper">
            <input v-model="edited.color" type="color" title="Цвет линии маршрута" />
            <button
              type="button"
              class="secondary small-button"
              title="Цвет для автобуса"
              @click="edited.color = '#0074dc'"
            >
              Автобус
            </button>
            <button
              type="button"
              class="secondary small-button"
              title="Цвет для троллейбуса"
              @click="edited.color = '#10b981'"
            >
              Троллейбус
            </button>
          </div>
        </label>
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
            @click="changeDirection(index)"
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
          :active-route-anchor="activeRouteAnchor"
          :preview-coordinates="previewCoordinates"
          :selected-stop-id="selectedMapStopId"
          :selected-stop-ids="selectedStopIds"
          :route-color="edited?.color"
          @stop-click="selectMapStop"
          @map-click="addVia"
          @route-anchor-move="moveRouteAnchor"
        />
        <div v-if="edited" class="map-hint">
          {{
            pointMode === 'stop'
              ? 'Нажмите на остановку, чтобы добавить её или открыть инструменты'
              : 'Нажмите возле нужного участка — точка вставится между ближайшими остановками'
          }}
        </div>
        <div v-if="edited && selectedMapStop" class="map-stop-actions" @click.stop>
          <button class="map-stop-close" title="Закрыть" @click="closeStopMenu">×</button>
          <strong>{{ selectedMapStop.name }}</strong>
          <template v-if="selectedMapStopIsInRoute">
            <span
              >Остановка {{ selectedStopIds.indexOf(selectedMapStop.id) + 1 }} в направлении</span
            >
            <button class="secondary stop-action" @click="beginRoadAnchorEditing">
              {{
                selectedStopHasCustomAnchor ? 'Изменить дорожную точку' : 'Добавить дорожную точку'
              }}
            </button>
            <button
              v-if="roadAnchorEditingStopId === selectedMapStop.id"
              class="stop-action"
              @click="finishRoadAnchorEditing"
            >
              Готово
            </button>
            <button
              class="secondary stop-action"
              :disabled="!selectedStopCanEditSchedule"
              @click="openScheduleEditor"
            >
              Редактировать расписание
            </button>
            <p v-if="!selectedStopCanEditSchedule">Сначала сохраните маршрут с этой остановкой.</p>
            <button class="text-danger stop-action" @click="removeSelectedStop">
              Удалить из маршрута
            </button>
            <button
              v-if="selectedStopHasCustomAnchor"
              class="secondary stop-action"
              @click="resetRouteAnchor"
            >
              Сбросить дорожную точку
            </button>
          </template>
          <template v-else>
            <span>Остановка не входит в это направление</span>
            <button class="stop-action" @click="addSelectedStop">Добавить в маршрут</button>
          </template>
        </div>
      </div>

      <aside
        v-if="edited && direction"
        class="panel route-order-panel"
        :class="{ 'route-schedule-panel': rightPanelMode === 'schedule' }"
      >
        <StopScheduleEditor
          v-if="rightPanelMode === 'schedule' && selectedMapStop"
          :route-number="edited.number"
          :direction-id="direction.id"
          :direction-name="direction.name || direction.terminal"
          :stop="selectedMapStop"
          @close="closeScheduleEditor"
        />
        <template v-else>
          <div class="route-order-heading">
            <div>
              <span>Направление {{ directionIndex + 1 }}</span>
              <strong>Порядок движения</strong>
            </div>
            <span>{{ direction.stopIds.length }} остановок</span>
          </div>

          <ol v-if="direction.routingPoints.length" class="waypoints route-waypoints">
            <template v-for="(point, index) in direction.routingPoints" :key="`${point.type}-${index}`">
              <!-- Drop zone BEFORE this card -->
              <li
                class="drop-zone"
                :class="{ active: dragOverIndex === index && dragIndex !== index && dragIndex !== index - 1 }"
              />
              <!-- Card itself -->
              <li
                class="waypoint-card"
                :class="{ dragging: dragIndex === index }"
                @pointerdown="startDrag($event, index)"
              >
                <span class="drag-handle" title="Перетащить">⠿</span>
                <span :class="point.type">{{ point.type === 'stop' ? pointOrder(index) : '•' }}</span>
                <strong>{{ pointName(point) }}</strong>
                <button title="Удалить" class="remove-btn" @click.stop="removePoint(index)">×</button>
              </li>
            </template>
            <!-- Drop zone AFTER the last card -->
            <li
              class="drop-zone"
              :class="{ active: dragOverIndex === direction.routingPoints.length && dragIndex !== direction.routingPoints.length - 1 }"
            />
          </ol>
          <div v-else class="empty-state">
            Выберите первую остановку на карте, затем остальные по порядку.
          </div>

          <p v-if="message" class="notice" :class="{ error: messageType === 'error' }">
            {{ message }}
          </p>

          <div class="route-actions">
            <button class="secondary" :disabled="routing" @click="buildGeometry()">
              {{ routing ? 'Прокладываем…' : 'Проложить по дорогам' }}
            </button>
            <button :disabled="saving" @click="save">
              {{ saving ? 'Сохраняем…' : 'Сохранить маршрут' }}
            </button>
          </div>
        </template>
      </aside>
    </div>
  </section>
</template>
