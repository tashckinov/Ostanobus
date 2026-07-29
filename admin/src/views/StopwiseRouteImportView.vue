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
  currentStopId?: string
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
    ([...originIds].some((id) => id === stopIds[0]) || [...destinationIds].some((id) => id === stopIds.at(-1)))
  ) {
    return 'high' as const
  }
  if (timed >= Math.max(2, Math.floor(schedules.length * 0.7))) return 'medium' as const
  return 'low' as const
}

function orderSchedules(schedules: ExportSchedule[]) {
  const ordered = [...schedules].sort((left, right) => schedulePosition(left) - schedulePosition(right))
  const originId = schedules.map((item) => item.originStopId).find((id) => id && schedules.some((s) => s.stopId === id))
  const destinationId = schedules
    .map((item) => item.destinationStopId)
    .find((id) => id && schedules.some((s) => s.stopId === id))

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

function changeRoute() {
  buildDraft(selectedLineId.value)
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
    <header class="page-header">
      <div>
        <h1>Импорт по остановкам</h1>
        <p>Загрузите общую выгрузку, выберите маршрут, проверьте порядок остановок и расписания.</p>
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
      <div class="panel import-summary">
        <div><span>Файл</span><strong>{{ fileName }}</strong></div>
        <label>
          Маршрут
          <select v-model="selectedLineId" @change="changeRoute">
            <option v-for="candidate in candidates" :key="candidate.route.lineId" :value="candidate.route.lineId">
              {{ candidate.route.name }} — {{ candidate.stopCount }} ост., {{ candidate.threadCount }} напр.
            </option>
          </select>
        </label>
        <label>Номер<input v-model="draft.number" /></label>
        <label>Название<input v-model="draft.name" /></label>
        <div><span>Найдено</span><strong>{{ selectedCandidate?.stopCount }} остановок · {{ scheduleCount }} записей</strong></div>
      </div>

      <div class="panel import-validation">
        <strong>{{ hasImportErrors ? 'Импорт невозможен' : 'Предварительная проверка' }}</strong>
        <ul>
          <li v-for="warning in warnings" :key="warning">{{ warning }}</li>
        </ul>
      </div>

      <div class="import-workspace">
        <aside class="panel directions-panel">
          <strong>Направления</strong>
          <button
            v-for="(item, index) in draft.directions"
            :key="item.id"
            :class="{ active: selectedDirectionIndex === index }"
            @click="selectedDirectionIndex = index; selectedStopId = null"
          >
            <span>{{ index + 1 }}</span>
            <div>
              <strong>{{ item.name }}</strong>
              <small>{{ item.stopIds.length }} остановок · {{ item.orderingConfidence }}</small>
            </div>
          </button>
        </aside>

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

        <aside class="panel stops-panel">
          <div class="stops-heading">
            <div><span>Порядок</span><strong>{{ direction?.name }}</strong></div>
            <span>{{ direction?.stopIds.length }}</span>
          </div>
          <ol>
            <li
              v-for="(stopId, index) in direction?.stopIds"
              :key="stopId"
              :class="{ selected: selectedStopId === stopId }"
              @click="selectedStopId = stopId"
            >
              <span>{{ index + 1 }}</span>
              <div><strong>{{ stopById.get(stopId)?.name ?? stopId }}</strong><small>{{ stopId }}</small></div>
              <div class="stop-controls">
                <button :disabled="index === 0" title="Выше" @click.stop="moveStop(index, -1)">↑</button>
                <button :disabled="index === (direction?.stopIds.length ?? 0) - 1" title="Ниже" @click.stop="moveStop(index, 1)">↓</button>
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

      <div class="panel import-footer">
        <label class="schedule-toggle">
          <input v-model="importSchedules" type="checkbox" />
          <span>Импортировать расписания для дня недели из serviceDate</span>
        </label>
        <p v-if="message" :class="messageType === 'error' ? 'error-text' : 'success-text'">{{ message }}</p>
        <button :disabled="hasImportErrors || importing" @click="importRoute">
          {{ importing ? 'Импорт…' : 'Маршрут проверен — загрузить' }}
        </button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.stopwise-import-page { min-height: 100%; }
.import-file-button { display: inline-flex; align-items: center; min-height: 42px; padding: 0 18px; background: #111827; color: #fff; cursor: pointer; font-weight: 700; }
.import-file-button input { display: none; }
.empty-import { min-height: 220px; display: grid; place-content: center; gap: 8px; text-align: center; }
.empty-import span, .import-summary span, .stops-heading span { color: #64748b; font-size: 12px; }
.import-summary { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(260px, 1.2fr) 100px minmax(200px, 1fr) 180px; gap: 14px; align-items: end; margin-bottom: 14px; }
.import-summary > div, .import-summary label { display: grid; gap: 6px; }
.import-validation { margin-bottom: 14px; }
.import-validation ul { margin: 8px 0 0; padding-left: 20px; color: #9a6700; }
.import-workspace { display: grid; grid-template-columns: 270px minmax(420px, 1fr) 380px; gap: 14px; min-height: 650px; }
.directions-panel, .stops-panel { min-height: 0; overflow: auto; }
.directions-panel > button { width: 100%; display: flex; gap: 10px; text-align: left; align-items: center; margin-top: 8px; padding: 10px; border: 1px solid #e2e8f0; background: #fff; color: #111827; }
.directions-panel > button.active { border-color: #111827; background: #f8fafc; }
.directions-panel > button > span { min-width: 28px; height: 28px; display: grid; place-items: center; background: #e2e8f0; }
.directions-panel button div { display: grid; gap: 3px; }
.directions-panel small, .stops-panel small { color: #64748b; }
.import-map { min-height: 650px; overflow: hidden; border: 1px solid #dbe2ea; }
.import-map :deep(.map) { min-height: 650px; height: 100%; }
.stops-heading { display: flex; justify-content: space-between; align-items: center; }
.stops-heading > div { display: grid; gap: 3px; }
.stops-panel ol { list-style: none; padding: 0; margin: 12px 0; display: grid; gap: 6px; }
.stops-panel li { display: grid; grid-template-columns: 28px 1fr auto; gap: 8px; align-items: center; padding: 8px; border: 1px solid #e2e8f0; cursor: pointer; }
.stops-panel li.selected { border-color: #111827; background: #f8fafc; }
.stops-panel li > span { color: #64748b; font-size: 12px; }
.stops-panel li > div { display: grid; gap: 2px; min-width: 0; }
.stop-controls { display: flex !important; grid-auto-flow: column; gap: 3px !important; }
.stop-controls button { min-width: 28px; min-height: 28px; padding: 0; background: #f1f5f9; color: #111827; }
.stop-controls button.remove { color: #b91c1c; font-size: 18px; }
.selected-stop { display: grid; gap: 8px; padding-top: 12px; border-top: 1px solid #e2e8f0; }
.selected-stop span { color: #64748b; font-size: 12px; }
.import-footer { display: flex; align-items: center; gap: 16px; margin-top: 14px; }
.import-footer > button { margin-left: auto; }
.schedule-toggle { display: flex; align-items: center; gap: 8px; }
.error-text { color: #b91c1c; }
.success-text { color: #166534; }
@media (max-width: 1250px) {
  .import-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .import-workspace { grid-template-columns: 240px minmax(420px, 1fr); }
  .stops-panel { grid-column: 1 / -1; max-height: 440px; }
}
</style>
