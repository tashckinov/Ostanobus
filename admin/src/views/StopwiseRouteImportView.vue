<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { api } from '../api'
import TransitMap from '../components/TransitMap.vue'
import type { Direction, Route, RouteSegment, Schedule, Stop } from '../types'

type ExportRoute = { lineId: string; name: string; type: string }
type ExportStop = { id: string; name: string; coordinates: [number, number] }
type ExportFrequency = { begin: string; end: string; intervalSeconds: number }
type ExportSchedule = {
  lineId: string
  threadId: string
  stopId: string
  originStopId?: string
  destinationStopId?: string
  destinationName?: string
  serviceDate?: string
  mode?: string
  scheduledTimes?: string[]
  frequencies?: ExportFrequency[]
}
type ExportPayload = {
  city?: string
  exportedAt?: string
  routes?: ExportRoute[]
  stops?: ExportStop[]
  schedules?: ExportSchedule[]
}
type Candidate = {
  route: ExportRoute
  schedules: ExportSchedule[]
  stopCount: number
  threadCount: number
}
type DraftStop = Stop & { sourceId: string }
type DraftDirection = Direction & {
  sourceThreadId: string
  sourceSchedules: ExportSchedule[]
  orderingConfidence: 'high' | 'medium' | 'low'
}
type Draft = {
  sourceLineId: string
  number: string
  name: string
  stops: DraftStop[]
  directions: DraftDirection[]
}

const existingStops = ref<Stop[]>([])
const existingRoutes = ref<Route[]>([])
const payload = ref<ExportPayload | null>(null)
const candidates = ref<Candidate[]>([])
const selectedLineId = ref('')
const draft = ref<Draft | null>(null)
const fileName = ref('')
const selectedDirectionIndex = ref(0)
const selectedStopId = ref<string | null>(null)
const importing = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const importSchedules = ref(true)

const direction = computed(() => draft.value?.directions[selectedDirectionIndex.value] ?? null)
const stopById = computed(() => new Map((draft.value?.stops ?? []).map((stop) => [stop.id, stop])))
const selectedStop = computed(() =>
  selectedStopId.value ? (stopById.value.get(selectedStopId.value) ?? null) : null,
)
const selectedCandidate = computed(() =>
  candidates.value.find((candidate) => candidate.route.lineId === selectedLineId.value) ?? null,
)
const hasImportErrors = computed(
  () => !draft.value || draft.value.directions.some((item) => item.stopIds.length < 2),
)
const scheduleCount = computed(() =>
  draft.value?.directions.reduce((total, item) => total + item.sourceSchedules.length, 0) ?? 0,
)
const exactDepartureCount = computed(() =>
  direction.value?.sourceSchedules.reduce(
    (total, item) => total + (item.scheduledTimes?.length ?? 0),
    0,
  ) ?? 0,
)
const intervalCount = computed(() =>
  direction.value?.sourceSchedules.reduce(
    (total, item) => total + (item.frequencies?.length ?? 0),
    0,
  ) ?? 0,
)
const warnings = computed(() => {
  const result: string[] = []
  const item = draft.value
  if (!item) return result
  if (item.directions.length < 2) result.push('В файле найдено только одно направление маршрута.')
  for (const [index, routeDirection] of item.directions.entries()) {
    if (routeDirection.orderingConfidence !== 'high') {
      result.push(
        `Направление ${index + 1}: порядок остановок восстановлен с ${
          routeDirection.orderingConfidence === 'medium' ? 'средней' : 'низкой'
        } уверенностью — проверьте его вручную.`,
      )
    }
  }
  const saved = existingRoutes.value.find(
    (route) => route.number.toLowerCase() === item.number.toLowerCase(),
  )
  if (saved) result.push(`Маршрут № ${item.number} уже существует и будет обновлён.`)
  result.push('Геометрии в поостановочной выгрузке нет: участки будут построены автоматически.')
  return result
})

function generatedId(kind: 'route' | 'direction' | 'segment') {
  return `${kind}-${crypto.randomUUID()}`
}

function parseMinutes(value: string | undefined) {
  if (!value) return null
  const [hours, minutes] = value.split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  return (hours ?? 0) * 60 + (minutes ?? 0)
}

function normalizedTimes(schedule: ExportSchedule) {
  const values = (schedule.scheduledTimes ?? [])
    .map(parseMinutes)
    .filter((value): value is number => value !== null)
  const interval = parseMinutes(schedule.frequencies?.[0]?.begin)
  if (interval !== null) values.push(interval)
  return values.sort((left, right) => left - right)
}

function schedulePosition(schedule: ExportSchedule) {
  const values = normalizedTimes(schedule)
  if (!values.length) return Number.MAX_SAFE_INTEGER
  const sample = values.slice(0, Math.min(5, values.length))
  return sample.reduce((sum, value) => sum + value, 0) / sample.length
}

function straightSegment(from: DraftStop, to: DraftStop): RouteSegment {
  return {
    id: generatedId('segment'),
    fromStopId: from.id,
    toStopId: to.id,
    mode: 'automatic',
    status: 'draft',
    viaPoints: [],
    geometry: {
      type: 'LineString',
      coordinates: [
        [from.longitude, from.latitude],
        [to.longitude, to.latitude],
      ],
    },
    distanceMeters: null,
  }
}

function buildSegments(stopIds: string[]) {
  const result: RouteSegment[] = []
  for (let index = 0; index < stopIds.length - 1; index += 1) {
    const from = stopById.value.get(stopIds[index]!)
    const to = stopById.value.get(stopIds[index + 1]!)
    if (from && to) result.push(straightSegment(from, to))
  }
  return result
}

function buildCandidates(source: ExportPayload) {
  const routes = Array.isArray(source.routes) ? source.routes : []
  const schedules = Array.isArray(source.schedules) ? source.schedules : []
  return routes
    .map((route) => {
      const routeSchedules = schedules.filter((item) => item.lineId === route.lineId)
      return {
        route,
        schedules: routeSchedules,
        stopCount: new Set(routeSchedules.map((item) => item.stopId)).size,
        threadCount: new Set(routeSchedules.map((item) => item.threadId)).size,
      }
    })
    .filter((item) => item.schedules.length > 0)
    .sort(
      (left, right) =>
        right.stopCount - left.stopCount ||
        right.threadCount - left.threadCount ||
        left.route.name.localeCompare(right.route.name, 'ru'),
    )
}

function inferConfidence(schedules: ExportSchedule[], stopIds: string[]) {
  if (stopIds.length < 2) return 'low' as const
  const originIds = new Set(schedules.map((item) => item.originStopId).filter(Boolean))
  const destinationIds = new Set(schedules.map((item) => item.destinationStopId).filter(Boolean))
  const timed = schedules.filter((item) => normalizedTimes(item).length > 0).length
  if (
    timed === schedules.length &&
    ([...originIds].some((id) => id === stopIds[0]) ||
      [...destinationIds].some((id) => id === stopIds.at(-1)))
  ) {
    return 'high' as const
  }
  if (timed >= Math.max(2, Math.floor(schedules.length * 0.7))) return 'medium' as const
  return 'low' as const
}

function orderSchedules(schedules: ExportSchedule[]) {
  const ordered = [...schedules].sort((left, right) => schedulePosition(left) - schedulePosition(right))
  const originId = schedules
    .map((item) => item.originStopId)
    .find((id) => id && schedules.some((schedule) => schedule.stopId === id))
  const destinationId = schedules
    .map((item) => item.destinationStopId)
    .find((id) => id && schedules.some((schedule) => schedule.stopId === id))

  if (originId) {
    const index = ordered.findIndex((item) => item.stopId === originId)
    if (index > 0) ordered.unshift(...ordered.splice(index, 1))
  }
  if (destinationId) {
    const index = ordered.findIndex((item) => item.stopId === destinationId)
    if (index >= 0 && index !== ordered.length - 1) ordered.push(...ordered.splice(index, 1))
  }
  return ordered
}

function buildDraft(lineId: string) {
  const source = payload.value
  const candidate = candidates.value.find((item) => item.route.lineId === lineId)
  if (!source || !candidate) return

  const rawStops = new Map((source.stops ?? []).map((stop) => [stop.id, stop]))
  const draftStops = new Map<string, DraftStop>()
  const threadGroups = new Map<string, ExportSchedule[]>()

  for (const schedule of candidate.schedules) {
    const stop = rawStops.get(schedule.stopId)
    if (stop && Array.isArray(stop.coordinates) && stop.coordinates.length >= 2) {
      draftStops.set(stop.id, {
        id: stop.id,
        sourceId: stop.id,
        cityId: 'volgodonsk',
        name: stop.name,
        shortName: stop.name,
        longitude: stop.coordinates[0],
        latitude: stop.coordinates[1],
        osmId: null,
        osmUrl: null,
        active: true,
      })
    }
    const group = threadGroups.get(schedule.threadId) ?? []
    group.push(schedule)
    threadGroups.set(schedule.threadId, group)
  }

  const directions: DraftDirection[] = []
  for (const [threadId, schedules] of threadGroups) {
    const ordered = orderSchedules(schedules.filter((item) => draftStops.has(item.stopId)))
    const stopIds = [...new Set(ordered.map((item) => item.stopId))]
    if (!stopIds.length) continue

    const first = draftStops.get(stopIds[0]!)
    const last = draftStops.get(stopIds.at(-1)!)
    const destination =
      ordered.map((item) => item.destinationName).find(Boolean) || last?.name || 'Конечная'

    directions.push({
      id: generatedId('direction'),
      sourceThreadId: threadId,
      sourceSchedules: ordered,
      orderingConfidence: inferConfidence(schedules, stopIds),
      name: first ? `${first.name} → ${destination}` : `Направление ${directions.length + 1}`,
      terminal: destination,
      stopIds,
      roadAnchors: [],
      routeType: 'linear',
      segments: [],
      active: true,
    })
  }

  draft.value = {
    sourceLineId: candidate.route.lineId,
    number: candidate.route.name,
    name: `Маршрут ${candidate.route.name}`,
    stops: [...draftStops.values()],
    directions: directions.sort((left, right) => right.stopIds.length - left.stopIds.length),
  }
  for (const item of draft.value.directions) item.segments = buildSegments(item.stopIds)
  selectedDirectionIndex.value = 0
  selectedStopId.value = null
  message.value = ''
}

async function readFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const parsed = JSON.parse(await file.text()) as ExportPayload
    if (!Array.isArray(parsed.routes) || !Array.isArray(parsed.stops) || !Array.isArray(parsed.schedules)) {
      throw new Error('Файл должен содержать массивы routes, stops и schedules.')
    }
    payload.value = parsed
    candidates.value = buildCandidates(parsed)
    if (!candidates.value.length) throw new Error('В файле не найдено маршрутов с расписаниями.')
    fileName.value = file.name
    selectedLineId.value = candidates.value[0]!.route.lineId
    buildDraft(selectedLineId.value)
  } catch (error) {
    payload.value = null
    candidates.value = []
    draft.value = null
    messageType.value = 'error'
    message.value = error instanceof Error ? error.message : 'Не удалось прочитать файл'
  }
}

function selectRoute(lineId: string) {
  selectedLineId.value = lineId
  buildDraft(lineId)
}

function selectDirection(index: number) {
  selectedDirectionIndex.value = index
  selectedStopId.value = null
}

function removeStop(stopId: string) {
  const item = draft.value
  const active = direction.value
  if (!item || !active) return
  active.stopIds = active.stopIds.filter((id) => id !== stopId)
  active.sourceSchedules = active.sourceSchedules.filter((schedule) => schedule.stopId !== stopId)
  active.segments = buildSegments(active.stopIds)
  if (!item.directions.some((routeDirection) => routeDirection.stopIds.includes(stopId))) {
    item.stops = item.stops.filter((stop) => stop.id !== stopId)
  }
  selectedStopId.value = null
}

function moveStop(index: number, delta: number) {
  const active = direction.value
  if (!active) return
  const target = index + delta
  if (target < 0 || target >= active.stopIds.length) return
  const [stopId] = active.stopIds.splice(index, 1)
  if (!stopId) return
  active.stopIds.splice(target, 0, stopId)
  active.segments = buildSegments(active.stopIds)
  active.orderingConfidence = 'high'
}

function distanceBetween(left: Stop, right: Stop) {
  const latitude = ((left.latitude + right.latitude) / 2) * (Math.PI / 180)
  const dx = (left.longitude - right.longitude) * Math.cos(latitude) * 111_320
  const dy = (left.latitude - right.latitude) * 110_540
  return Math.sqrt(dx * dx + dy * dy)
}

function existingStop(imported: DraftStop) {
  return existingStops.value.find(
    (stop) => stop.name === imported.name && distanceBetween(stop, imported) < 80,
  )
}

function serviceDay(schedule: ExportSchedule) {
  if (!schedule.serviceDate) return null
  const date = new Date(`${schedule.serviceDate}T12:00:00`)
  if (Number.isNaN(date.getTime())) return null
  const day = date.getDay()
  return day === 0 ? 7 : day
}

function serviceDateLabel(schedule: ExportSchedule) {
  if (!schedule.serviceDate) return 'Дата не указана'
  const date = new Date(`${schedule.serviceDate}T12:00:00`)
  if (Number.isNaN(date.getTime())) return schedule.serviceDate
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    weekday: 'short',
  }).format(date)
}

function scheduleForStop(stopId: string) {
  return direction.value?.sourceSchedules.find((item) => item.stopId === stopId) ?? null
}

function scheduleModeLabel(schedule: ExportSchedule) {
  if ((schedule.scheduledTimes?.length ?? 0) > 0) return 'Точное расписание'
  if ((schedule.frequencies?.length ?? 0) > 0) return 'Интервальное расписание'
  return 'Нет времени'
}

function transportLabel(type: string) {
  if (type === 'bus') return 'Автобус'
  if (type === 'minibus') return 'Маршрутка'
  if (type === 'trolleybus') return 'Троллейбус'
  return type || 'Транспорт'
}

function confidenceLabel(value: DraftDirection['orderingConfidence']) {
  if (value === 'high') return 'Порядок подтверждён'
  if (value === 'medium') return 'Нужно проверить'
  return 'Низкая уверенность'
}

async function saveDirectionSchedules(
  routeDirection: DraftDirection,
  directionId: string,
  idMap: Map<string, string>,
) {
  const old = await api.schedules(directionId)
  for (const schedule of old) {
    if (schedule.id) await api.deleteSchedule(schedule.id)
  }

  for (const source of routeDirection.sourceSchedules) {
    const stopId = idMap.get(source.stopId)
    const day = serviceDay(source)
    if (!stopId || !day) continue
    for (const time of source.scheduledTimes ?? []) {
      const schedule: Schedule = {
        directionId,
        stopId,
        days: [day],
        type: 'exact',
        departureTime: time,
        startTime: null,
        endTime: null,
        headwayMinutes: null,
        active: true,
      }
      await api.saveSchedule(schedule)
    }
    for (const frequency of source.frequencies ?? []) {
      const schedule: Schedule = {
        directionId,
        stopId,
        days: [day],
        type: 'interval',
        departureTime: null,
        startTime: frequency.begin,
        endTime: frequency.end,
        headwayMinutes: Math.max(1, Math.round(frequency.intervalSeconds / 60)),
        active: true,
      }
      await api.saveSchedule(schedule)
    }
  }
}

async function importRoute() {
  const item = draft.value
  if (!item || hasImportErrors.value) return
  importing.value = true
  message.value = ''
  try {
    const idMap = new Map<string, string>()
    for (const imported of item.stops) {
      const found = existingStop(imported)
      if (found) {
        idMap.set(imported.id, found.id)
        continue
      }
      const saved = await api.saveStop({
        cityId: 'volgodonsk',
        name: imported.name,
        shortName: imported.shortName,
        longitude: imported.longitude,
        latitude: imported.latitude,
        osmId: null,
        osmUrl: null,
        active: true,
      })
      idMap.set(imported.id, saved.id)
    }

    const oldRoute = existingRoutes.value.find(
      (route) => route.number.toLowerCase() === item.number.toLowerCase(),
    )
    const directionMap = new Map<string, string>()
    const directions: Direction[] = []

    for (const sourceDirection of item.directions) {
      const mappedStopIds = sourceDirection.stopIds.map((id) => idMap.get(id) ?? id)
      const segments: RouteSegment[] = []
      for (let index = 0; index < sourceDirection.stopIds.length - 1; index += 1) {
        const fromSource = stopById.value.get(sourceDirection.stopIds[index]!)
        const toSource = stopById.value.get(sourceDirection.stopIds[index + 1]!)
        if (!fromSource || !toSource) continue
        let geometry: GeoJSON.LineString
        let distanceMeters: number | null = null
        try {
          const built = await api.buildGeometry([
            [fromSource.longitude, fromSource.latitude],
            [toSource.longitude, toSource.latitude],
          ])
          geometry = built.geometry
          distanceMeters = built.distanceMeters
        } catch {
          geometry = {
            type: 'LineString',
            coordinates: [
              [fromSource.longitude, fromSource.latitude],
              [toSource.longitude, toSource.latitude],
            ],
          }
        }
        segments.push({
          id: generatedId('segment'),
          fromStopId: mappedStopIds[index]!,
          toStopId: mappedStopIds[index + 1]!,
          mode: 'automatic',
          status: 'draft',
          viaPoints: [],
          geometry,
          distanceMeters,
        })
      }
      const directionId =
        oldRoute?.directions.find((saved) => saved.terminal === sourceDirection.terminal)?.id ??
        generatedId('direction')
      directionMap.set(sourceDirection.sourceThreadId, directionId)
      directions.push({
        id: directionId,
        name: sourceDirection.name,
        terminal: sourceDirection.terminal,
        stopIds: mappedStopIds,
        roadAnchors: [],
        routeType: 'linear',
        segments,
        active: true,
      })
    }

    await api.saveRoute({
      routeId: oldRoute?.routeId ?? generatedId('route'),
      cityId: 'volgodonsk',
      number: item.number.trim(),
      name: item.name.trim() || null,
      color: oldRoute?.color ?? '#0074dc',
      active: true,
      isMock: false,
      directions,
    })

    if (importSchedules.value) {
      for (const sourceDirection of item.directions) {
        const directionId = directionMap.get(sourceDirection.sourceThreadId)
        if (directionId) await saveDirectionSchedules(sourceDirection, directionId, idMap)
      }
    }

    ;[existingStops.value, existingRoutes.value] = await Promise.all([api.stops(), api.routes()])
    messageType.value = 'success'
    message.value = `Маршрут № ${item.number} загружен: ${directions.length} направлений, ${item.stops.length} остановок${
      importSchedules.value ? `, расписаний: ${scheduleCount.value}` : ''
    }.`
  } catch (error) {
    messageType.value = 'error'
    message.value = error instanceof Error ? error.message : 'Не удалось импортировать маршрут'
  } finally {
    importing.value = false
  }
}

onMounted(async () => {
  ;[existingStops.value, existingRoutes.value] = await Promise.all([api.stops(), api.routes()])
})
</script>

<template>
  <section class="editor-page stopwise-import-page">
    <header class="page-header import-header">
      <div>
        <h1>Импорт по остановкам</h1>
        <p>Выберите маршрут карточкой, проверьте направления, порядок остановок и расписание.</p>
      </div>
      <label class="import-file-button">
        <input type="file" accept="application/json,.json" @change="readFile" />
        Выбрать JSON
      </label>
    </header>

    <div v-if="!payload" class="panel empty-import">
      <strong>Загрузите ostanobus_export.json</strong>
      <span>Ожидаются массивы routes, stops и schedules.</span>
      <p v-if="message" class="error-text">{{ message }}</p>
    </div>

    <template v-else-if="draft">
      <section class="panel source-summary">
        <div>
          <span>Файл</span>
          <strong>{{ fileName }}</strong>
        </div>
        <div>
          <span>Город</span>
          <strong>{{ payload.city || 'Не указан' }}</strong>
        </div>
        <div>
          <span>Выгружено</span>
          <strong>{{ payload.exportedAt ? new Date(payload.exportedAt).toLocaleString('ru-RU') : 'Не указано' }}</strong>
        </div>
        <div>
          <span>Всего маршрутов</span>
          <strong>{{ candidates.length }}</strong>
        </div>
      </section>

      <section class="route-picker-section">
        <div class="section-heading">
          <div>
            <span>1. Выберите маршрут</span>
            <strong>Маршруты из выгрузки</strong>
          </div>
          <span>{{ candidates.length }}</span>
        </div>
        <div class="route-card-grid">
          <button
            v-for="candidate in candidates"
            :key="candidate.route.lineId"
            class="route-card"
            :class="{ active: selectedLineId === candidate.route.lineId }"
            @click="selectRoute(candidate.route.lineId)"
          >
            <span class="route-badge">{{ candidate.route.name }}</span>
            <div class="route-card-copy">
              <strong>{{ transportLabel(candidate.route.type) }}</strong>
              <span>{{ candidate.stopCount }} остановок</span>
              <span>{{ candidate.threadCount }} направл.</span>
            </div>
            <small>{{ candidate.route.lineId }}</small>
          </button>
        </div>
      </section>

      <section class="panel route-details">
        <div class="route-title-block">
          <span>2. Проверьте маршрут</span>
          <strong>Маршрут № {{ draft.number }}</strong>
          <small>{{ selectedCandidate?.stopCount }} остановок · {{ scheduleCount }} записей расписания</small>
        </div>
        <label>
          Номер
          <input v-model="draft.number" />
        </label>
        <label>
          Название
          <input v-model="draft.name" />
        </label>
      </section>

      <section class="validation-strip" :class="{ error: hasImportErrors }">
        <div>
          <strong>{{ hasImportErrors ? 'Импорт невозможен' : 'Проверка данных' }}</strong>
          <span>{{ warnings.length }} замечаний</span>
        </div>
        <ul>
          <li v-for="warning in warnings" :key="warning">{{ warning }}</li>
        </ul>
      </section>

      <div class="direction-tabs">
        <button
          v-for="(item, index) in draft.directions"
          :key="item.id"
          :class="{ active: selectedDirectionIndex === index }"
          @click="selectDirection(index)"
        >
          <span>{{ index + 1 }}</span>
          <div>
            <strong>{{ item.name }}</strong>
            <small>{{ item.stopIds.length }} остановок</small>
          </div>
          <em :class="item.orderingConfidence">{{ confidenceLabel(item.orderingConfidence) }}</em>
        </button>
      </div>

      <div class="import-main-grid">
        <div class="import-map">
          <TransitMap
            :stops="draft.stops"
            :segments="direction?.segments"
            :selected-stop-id="selectedStopId"
            :selected-stop-ids="direction?.stopIds"
            route-color="#0074dc"
            @stop-click="selectedStopId = $event.id"
          />
        </div>

        <aside class="panel stop-order-panel">
          <div class="panel-heading">
            <div>
              <span>Порядок остановок</span>
              <strong>{{ direction?.name }}</strong>
            </div>
            <span>{{ direction?.stopIds.length }}</span>
          </div>
          <ol>
            <li
              v-for="(stopId, index) in direction?.stopIds"
              :key="stopId"
              :class="{ selected: selectedStopId === stopId }"
              @click="selectedStopId = stopId"
            >
              <span class="stop-index">{{ index + 1 }}</span>
              <div>
                <strong>{{ stopById.get(stopId)?.name ?? stopId }}</strong>
                <small>{{ stopId }}</small>
              </div>
              <div class="stop-controls">
                <button :disabled="index === 0" title="Выше" @click.stop="moveStop(index, -1)">↑</button>
                <button
                  :disabled="index === (direction?.stopIds.length ?? 0) - 1"
                  title="Ниже"
                  @click.stop="moveStop(index, 1)"
                >
                  ↓
                </button>
                <button class="remove" title="Удалить" @click.stop="removeStop(stopId)">×</button>
              </div>
            </li>
          </ol>
          <div v-if="selectedStop" class="selected-stop">
            <strong>{{ selectedStop.name }}</strong>
            <span>{{ selectedStop.longitude.toFixed(6) }}, {{ selectedStop.latitude.toFixed(6) }}</span>
            <button class="danger" @click="removeStop(selectedStop.id)">Удалить из направления</button>
          </div>
        </aside>
      </div>

      <section class="panel schedule-section">
        <div class="schedule-heading">
          <div>
            <span>3. Проверьте расписание</span>
            <strong>{{ direction?.name }}</strong>
          </div>
          <div class="schedule-stats">
            <span><strong>{{ exactDepartureCount }}</strong> точных отправлений</span>
            <span><strong>{{ intervalCount }}</strong> интервалов</span>
          </div>
        </div>

        <div class="schedule-table">
          <article v-for="(stopId, index) in direction?.stopIds" :key="stopId" class="schedule-row">
            <div class="schedule-stop">
              <span>{{ index + 1 }}</span>
              <div>
                <strong>{{ stopById.get(stopId)?.name ?? stopId }}</strong>
                <small>{{ serviceDateLabel(scheduleForStop(stopId) ?? {}) }}</small>
              </div>
            </div>
            <template v-if="scheduleForStop(stopId)">
              <div class="schedule-mode">
                <strong>{{ scheduleModeLabel(scheduleForStop(stopId)!) }}</strong>
                <small>threadId {{ scheduleForStop(stopId)!.threadId }}</small>
              </div>
              <div v-if="scheduleForStop(stopId)!.scheduledTimes?.length" class="time-chip-list">
                <span v-for="time in scheduleForStop(stopId)!.scheduledTimes" :key="time">{{ time }}</span>
              </div>
              <div v-else-if="scheduleForStop(stopId)!.frequencies?.length" class="frequency-list">
                <span v-for="frequency in scheduleForStop(stopId)!.frequencies" :key="`${frequency.begin}-${frequency.end}`">
                  {{ frequency.begin }}–{{ frequency.end }} · каждые {{ Math.round(frequency.intervalSeconds / 60) }} мин
                </span>
              </div>
              <div v-else class="schedule-empty">Время отсутствует</div>
            </template>
            <div v-else class="schedule-empty">Для остановки нет записи расписания</div>
          </article>
        </div>
      </section>

      <footer class="panel import-footer">
        <label class="schedule-toggle">
          <input v-model="importSchedules" type="checkbox" />
          <span>
            <strong>Импортировать расписания</strong>
            <small>День недели определяется по serviceDate каждой записи</small>
          </span>
        </label>
        <p v-if="message" :class="messageType === 'error' ? 'error-text' : 'success-text'">{{ message }}</p>
        <button :disabled="hasImportErrors || importing" @click="importRoute">
          {{ importing ? 'Импорт…' : 'Маршрут проверен — загрузить' }}
        </button>
      </footer>
    </template>
  </section>
</template>

<style scoped>
.stopwise-import-page { min-height: 100%; }
.import-header { border-bottom: 1px solid #e2e8f0; padding-bottom: 18px; }
.import-file-button { display: inline-flex; align-items: center; justify-content: center; min-height: 42px; padding: 0 18px; background: #111827; color: #fff; font-weight: 700; cursor: pointer; }
.import-file-button input { display: none; }
.empty-import { min-height: 260px; display: grid; place-content: center; gap: 10px; text-align: center; }
.empty-import span { color: #64748b; }
.source-summary { display: grid; grid-template-columns: 2fr 1fr 1.4fr .7fr; gap: 18px; margin-bottom: 20px; }
.source-summary div { display: grid; gap: 5px; min-width: 0; }
.source-summary span, .section-heading span, .route-title-block span, .panel-heading span, .schedule-heading span { color: #64748b; font-size: 12px; }
.source-summary strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.route-picker-section { margin-bottom: 20px; }
.section-heading { display: flex; justify-content: space-between; align-items: end; margin-bottom: 10px; }
.section-heading div { display: grid; gap: 3px; }
.section-heading strong { font-size: 18px; }
.route-card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
.route-card { min-height: 112px; display: grid; grid-template-columns: auto 1fr; gap: 10px; text-align: left; background: #fff; color: #111827; border: 1px solid #dbe2ea; padding: 14px; }
.route-card:hover { border-color: #94a3b8; }
.route-card.active { border: 2px solid #111827; padding: 13px; background: #f8fafc; }
.route-badge { min-width: 48px; height: 34px; display: grid; place-items: center; border: 2px solid #111827; font-weight: 800; font-size: 16px; }
.route-card-copy { display: grid; gap: 2px; }
.route-card-copy span, .route-card small { color: #64748b; font-size: 12px; }
.route-card small { grid-column: 1 / -1; }
.route-details { display: grid; grid-template-columns: minmax(240px, 1fr) 130px minmax(260px, 1.2fr); align-items: end; gap: 14px; margin-bottom: 12px; }
.route-title-block { display: grid; gap: 3px; }
.route-title-block > strong { font-size: 20px; }
.route-title-block small { color: #64748b; }
.route-details label { display: grid; gap: 6px; color: #64748b; font-size: 12px; }
.validation-strip { display: grid; grid-template-columns: 220px 1fr; gap: 18px; padding: 14px 16px; margin-bottom: 16px; border-left: 4px solid #d97706; background: #fffbeb; }
.validation-strip.error { border-left-color: #b91c1c; background: #fef2f2; }
.validation-strip > div { display: grid; gap: 3px; align-content: start; }
.validation-strip > div span { color: #64748b; font-size: 12px; }
.validation-strip ul { margin: 0; padding-left: 18px; color: #92400e; }
.validation-strip.error ul { color: #991b1b; }
.direction-tabs { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px; margin-bottom: 12px; }
.direction-tabs button { display: grid; grid-template-columns: 34px 1fr auto; gap: 10px; align-items: center; text-align: left; background: #fff; color: #111827; border: 1px solid #dbe2ea; padding: 12px; }
.direction-tabs button.active { border: 2px solid #111827; padding: 11px; background: #f8fafc; }
.direction-tabs button > span { width: 30px; height: 30px; display: grid; place-items: center; background: #e2e8f0; font-weight: 700; }
.direction-tabs button div { display: grid; gap: 3px; }
.direction-tabs small { color: #64748b; }
.direction-tabs em { font-style: normal; font-size: 11px; padding: 4px 7px; background: #fef3c7; color: #92400e; }
.direction-tabs em.high { background: #dcfce7; color: #166534; }
.direction-tabs em.low { background: #fee2e2; color: #991b1b; }
.import-main-grid { display: grid; grid-template-columns: minmax(520px, 1fr) 360px; gap: 12px; min-height: 620px; margin-bottom: 12px; }
.import-map { min-height: 620px; overflow: hidden; border: 1px solid #dbe2ea; background: #eef2f6; }
.import-map :deep(.map) { height: 100%; min-height: 620px; }
.stop-order-panel { min-height: 0; overflow: auto; }
.panel-heading, .schedule-heading { display: flex; justify-content: space-between; align-items: start; gap: 12px; }
.panel-heading > div, .schedule-heading > div:first-child { display: grid; gap: 3px; }
.stop-order-panel ol { list-style: none; margin: 12px 0; padding: 0; display: grid; gap: 6px; }
.stop-order-panel li { display: grid; grid-template-columns: 30px 1fr auto; gap: 8px; align-items: center; border: 1px solid #e2e8f0; padding: 8px; cursor: pointer; }
.stop-order-panel li.selected { border-color: #111827; background: #f8fafc; }
.stop-index { color: #64748b; font-size: 12px; }
.stop-order-panel li div { display: grid; gap: 2px; min-width: 0; }
.stop-order-panel li small { color: #64748b; }
.stop-controls { display: flex !important; gap: 4px; }
.stop-controls button { min-width: 28px; min-height: 28px; padding: 0; background: #fff; color: #111827; border: 1px solid #cbd5e1; }
.stop-controls button.remove { color: #b91c1c; }
.selected-stop { display: grid; gap: 8px; padding-top: 12px; border-top: 1px solid #e2e8f0; }
.selected-stop span { color: #64748b; font-size: 12px; }
.schedule-section { margin-bottom: 12px; }
.schedule-heading { margin-bottom: 14px; }
.schedule-stats { display: flex; gap: 8px; flex-wrap: wrap; }
.schedule-stats span { padding: 7px 10px; background: #f1f5f9; color: #475569; }
.schedule-table { display: grid; gap: 6px; }
.schedule-row { display: grid; grid-template-columns: minmax(230px, .9fr) minmax(180px, .65fr) minmax(300px, 1.45fr); gap: 14px; align-items: start; padding: 12px; border: 1px solid #e2e8f0; }
.schedule-stop { display: grid; grid-template-columns: 28px 1fr; gap: 8px; }
.schedule-stop > span { width: 26px; height: 26px; display: grid; place-items: center; background: #e2e8f0; font-size: 12px; font-weight: 700; }
.schedule-stop div, .schedule-mode { display: grid; gap: 3px; }
.schedule-stop small, .schedule-mode small { color: #64748b; }
.time-chip-list { display: flex; flex-wrap: wrap; gap: 5px; max-height: 112px; overflow: auto; }
.time-chip-list span { padding: 4px 7px; background: #eef2ff; border: 1px solid #c7d2fe; font-variant-numeric: tabular-nums; }
.frequency-list { display: grid; gap: 5px; }
.frequency-list span { padding: 7px 9px; background: #ecfdf5; border-left: 3px solid #10b981; }
.schedule-empty { color: #94a3b8; font-size: 13px; }
.import-footer { display: flex; align-items: center; gap: 16px; position: sticky; bottom: 0; z-index: 5; border-top: 2px solid #111827; }
.schedule-toggle { display: flex; gap: 10px; align-items: start; }
.schedule-toggle span { display: grid; gap: 2px; }
.schedule-toggle small { color: #64748b; }
.import-footer p { margin: 0; margin-left: auto; }
.import-footer > button { margin-left: auto; min-width: 250px; }
.error-text { color: #b91c1c; }
.success-text { color: #166534; }
@media (max-width: 1300px) {
  .source-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .import-main-grid { grid-template-columns: 1fr; }
  .stop-order-panel { max-height: 520px; }
  .schedule-row { grid-template-columns: 1fr 1fr; }
  .schedule-row > :last-child { grid-column: 1 / -1; }
}
@media (max-width: 760px) {
  .route-details, .validation-strip, .schedule-row { grid-template-columns: 1fr; }
  .source-summary { grid-template-columns: 1fr; }
  .direction-tabs button { grid-template-columns: 34px 1fr; }
  .direction-tabs em { grid-column: 2; justify-self: start; }
  .import-footer { align-items: stretch; flex-direction: column; }
  .import-footer > button { margin-left: 0; width: 100%; }
}
</style>
