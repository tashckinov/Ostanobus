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
type ImportMode = 'route-and-schedules' | 'schedules-only'
type DayMode = 'source' | 'all'

const existingStops = ref<Stop[]>([])
const existingRoutes = ref<Route[]>([])
const payload = ref<ExportPayload | null>(null)
const candidates = ref<Candidate[]>([])
const selectedLineId = ref('')
const draft = ref<Draft | null>(null)
const fileName = ref('')
const selectedDirectionIndex = ref(0)
const selectedStopId = ref<string | null>(null)
const importMode = ref<ImportMode>('route-and-schedules')
const dayMode = ref<DayMode>('source')
const importing = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')

const direction = computed(() => draft.value?.directions[selectedDirectionIndex.value] ?? null)
const stopById = computed(() => new Map((draft.value?.stops ?? []).map((stop) => [stop.id, stop])))
const selectedStop = computed(() =>
  selectedStopId.value ? (stopById.value.get(selectedStopId.value) ?? null) : null,
)
const selectedCandidate = computed(() =>
  candidates.value.find((candidate) => candidate.route.lineId === selectedLineId.value) ?? null,
)
const existingRoute = computed(() => {
  const number = draft.value?.number.trim().toLocaleLowerCase('ru-RU')
  return number
    ? (existingRoutes.value.find((route) => route.number.trim().toLocaleLowerCase('ru-RU') === number) ?? null)
    : null
})
const routeCanBeSaved = computed(
  () => Boolean(draft.value?.directions.length) && draft.value!.directions.every((item) => item.stopIds.length >= 2),
)
const schedulesCanBeUpdated = computed(() => Boolean(existingRoute.value && selectedCandidate.value?.schedules.length))
const importDisabled = computed(() => {
  if (importing.value || !draft.value) return true
  return importMode.value === 'route-and-schedules' ? !routeCanBeSaved.value : !schedulesCanBeUpdated.value
})
const scheduleCount = computed(() =>
  direction.value?.sourceSchedules.reduce(
    (total, item) => total + (item.scheduledTimes?.length ?? 0) + (item.frequencies?.length ?? 0),
    0,
  ) ?? 0,
)
const allRouteScheduleCount = computed(() =>
  draft.value?.directions.reduce(
    (total, item) =>
      total +
      item.sourceSchedules.reduce(
        (inner, schedule) =>
          inner + (schedule.scheduledTimes?.length ?? 0) + (schedule.frequencies?.length ?? 0),
        0,
      ),
    0,
  ) ?? 0,
)
const sourceDayLabels = computed(() => {
  const labels = new Set<string>()
  for (const routeDirection of draft.value?.directions ?? []) {
    for (const schedule of routeDirection.sourceSchedules) {
      const label = serviceDateLabel(schedule)
      if (label !== 'Дата не указана') labels.add(label)
    }
  }
  return [...labels]
})
const warnings = computed(() => {
  const result: string[] = []
  const item = draft.value
  if (!item) return result
  if (item.directions.length < 2) result.push('В выгрузке найдено только одно направление. При обновлении существующего маршрута второе направление будет сохранено без изменений.')
  for (const [index, routeDirection] of item.directions.entries()) {
    if (routeDirection.orderingConfidence !== 'high') {
      result.push(
        `Направление ${index + 1}: порядок остановок восстановлен с ${
          routeDirection.orderingConfidence === 'medium' ? 'средней' : 'низкой'
        } уверенностью — проверьте его вручную.`,
      )
    }
  }
  if (!routeCanBeSaved.value) {
    result.push('Маршрут целиком нельзя сохранить: хотя бы в одном направлении меньше двух остановок. Можно выбрать режим «Только расписания», если маршрут уже существует.')
  }
  if (existingRoute.value) result.push(`Маршрут № ${item.number} уже существует. Будут изменены только выбранный маршрут и расписания остановок из файла.`)
  result.push('Остальные маршруты из загруженного файла не импортируются.')
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
    const destination = ordered.map((item) => item.destinationName).find(Boolean) || last?.name || 'Конечная'
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
  importMode.value = existingRoute.value && !routeCanBeSaved.value ? 'schedules-only' : 'route-and-schedules'
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

function findExistingStop(imported: DraftStop) {
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

function scheduleDays(schedule: ExportSchedule) {
  if (dayMode.value === 'all') return [1, 2, 3, 4, 5, 6, 7]
  const day = serviceDay(schedule)
  return day ? [day] : []
}

function serviceDateLabel(schedule: ExportSchedule) {
  if (!schedule.serviceDate) return 'Дата не указана'
  const date = new Date(`${schedule.serviceDate}T12:00:00`)
  if (Number.isNaN(date.getTime())) return schedule.serviceDate
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'long',
    weekday: 'short',
  }).format(date)
}

function scheduleForStop(stopId: string) {
  return direction.value?.sourceSchedules.find((item) => item.stopId === stopId) ?? null
}

function scheduleModeLabel(schedule: ExportSchedule) {
  if (schedule.scheduledTimes?.length) return 'Точное расписание'
  if (schedule.frequencies?.length) return 'Интервальное расписание'
  return 'Времён нет'
}

function transportLabel(type: string) {
  if (type === 'minibus') return 'Маршрутка'
  if (type === 'trolleybus') return 'Троллейбус'
  return 'Автобус'
}

function normalized(value: string | undefined) {
  return (value ?? '').trim().toLocaleLowerCase('ru-RU')
}

function matchExistingDirection(route: Route, sourceDirection: DraftDirection, mappedStopIds: string[]) {
  const terminal = normalized(sourceDirection.terminal)
  const byTerminal = route.directions.filter(
    (item) => normalized(item.terminal) === terminal && mappedStopIds.some((stopId) => item.stopIds.includes(stopId)),
  )
  if (byTerminal.length === 1) return byTerminal[0]!
  const byStop = route.directions.filter((item) => mappedStopIds.some((stopId) => item.stopIds.includes(stopId)))
  return byStop.length === 1 ? byStop[0]! : null
}

function matchDirectionForSchedule(route: Route, source: ExportSchedule, stopId: string) {
  const destination = normalized(source.destinationName)
  const byTerminal = route.directions.filter(
    (item) => item.stopIds.includes(stopId) && destination && normalized(item.terminal) === destination,
  )
  if (byTerminal.length === 1) return byTerminal[0]!
  const byStop = route.directions.filter((item) => item.stopIds.includes(stopId))
  return byStop.length === 1 ? byStop[0]! : null
}

async function replaceStopSchedule(directionId: string, stopId: string, source: ExportSchedule) {
  const days = scheduleDays(source)
  if (!days.length) return 0

  const old = await api.schedules(directionId, stopId)
  for (const schedule of old) {
    if (schedule.id) await api.deleteSchedule(schedule.id)
  }

  let saved = 0
  for (const departureTime of source.scheduledTimes ?? []) {
    const schedule: Schedule = {
      directionId,
      stopId,
      days,
      type: 'exact',
      departureTime,
      startTime: null,
      endTime: null,
      headwayMinutes: null,
      active: true,
    }
    await api.saveSchedule(schedule)
    saved += 1
  }
  for (const frequency of source.frequencies ?? []) {
    const schedule: Schedule = {
      directionId,
      stopId,
      days,
      type: 'interval',
      departureTime: null,
      startTime: frequency.begin,
      endTime: frequency.end,
      headwayMinutes: Math.max(1, Math.round(frequency.intervalSeconds / 60)),
      active: true,
    }
    await api.saveSchedule(schedule)
    saved += 1
  }

  const verified = await api.schedules(directionId, stopId)
  if (saved > 0 && verified.length === 0) {
    throw new Error(`Расписание остановки ${stopId} не сохранилось`)
  }
  return saved
}

async function ensureStopMap(createMissing: boolean) {
  const item = draft.value
  if (!item) return new Map<string, string>()
  const idMap = new Map<string, string>()
  for (const imported of item.stops) {
    const found = findExistingStop(imported)
    if (found) {
      idMap.set(imported.id, found.id)
      continue
    }
    if (!createMissing) continue
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
  return idMap
}

async function buildImportedDirection(sourceDirection: DraftDirection, idMap: Map<string, string>, oldRoute: Route | null) {
  const mappedStopIds = sourceDirection.stopIds.map((id) => idMap.get(id) ?? id)
  const matched = oldRoute ? matchExistingDirection(oldRoute, sourceDirection, mappedStopIds) : null
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
  const result: Direction = {
    id: matched?.id ?? generatedId('direction'),
    name: sourceDirection.name,
    terminal: sourceDirection.terminal,
    stopIds: mappedStopIds,
    roadAnchors: [],
    routeType: 'linear',
    segments,
    active: true,
  }
  return { direction: result, matchedId: matched?.id ?? null }
}

async function importRouteAndSchedules() {
  const item = draft.value
  if (!item || !routeCanBeSaved.value) return
  const idMap = await ensureStopMap(true)
  const oldRoute = existingRoute.value
  const imported: Array<{ source: DraftDirection; direction: Direction; matchedId: string | null }> = []
  for (const source of item.directions) {
    const built = await buildImportedDirection(source, idMap, oldRoute)
    imported.push({ source, ...built })
  }

  const matchedIds = new Set(imported.map((item) => item.matchedId).filter((id): id is string => Boolean(id)))
  const preservedDirections = oldRoute?.directions.filter((item) => !matchedIds.has(item.id)) ?? []
  const directions = [...preservedDirections, ...imported.map((item) => item.direction)]

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

  let savedSchedules = 0
  let touchedStops = 0
  for (const importedDirection of imported) {
    for (const source of importedDirection.source.sourceSchedules) {
      const stopId = idMap.get(source.stopId)
      if (!stopId) continue
      savedSchedules += await replaceStopSchedule(importedDirection.direction.id, stopId, source)
      touchedStops += 1
    }
  }
  return { savedSchedules, touchedStops, directions: imported.length }
}

async function importSchedulesOnly() {
  const route = existingRoute.value
  const item = draft.value
  if (!route || !item) throw new Error('Сначала должен существовать маршрут с таким номером')
  const idMap = await ensureStopMap(false)
  let savedSchedules = 0
  let touchedStops = 0
  let skipped = 0

  for (const routeDirection of item.directions) {
    for (const source of routeDirection.sourceSchedules) {
      const stopId = idMap.get(source.stopId)
      if (!stopId) {
        skipped += 1
        continue
      }
      const targetDirection = matchDirectionForSchedule(route, source, stopId)
      if (!targetDirection) {
        skipped += 1
        continue
      }
      savedSchedules += await replaceStopSchedule(targetDirection.id, stopId, source)
      touchedStops += 1
    }
  }
  return { savedSchedules, touchedStops, skipped }
}

async function runImport() {
  if (importDisabled.value || !draft.value) return
  importing.value = true
  message.value = ''
  try {
    const otherRoutes = Math.max(0, candidates.value.length - 1)
    if (importMode.value === 'route-and-schedules') {
      const result = await importRouteAndSchedules()
      if (!result) return
      message.value = `Импортирован только маршрут № ${draft.value.number}: направлений ${result.directions}, остановок с обновлённым расписанием ${result.touchedStops}, записей расписания ${result.savedSchedules}. Остальные маршруты в файле (${otherRoutes}) не изменены.`
    } else {
      const result = await importSchedulesOnly()
      message.value = `Обновлено только расписание маршрута № ${draft.value.number}: остановок ${result.touchedStops}, записей ${result.savedSchedules}${result.skipped ? `, пропущено записей: ${result.skipped}` : ''}. Геометрия и порядок маршрута не изменялись.`
    }
    messageType.value = 'success'
    ;[existingStops.value, existingRoutes.value] = await Promise.all([api.stops(), api.routes()])
  } catch (error) {
    messageType.value = 'error'
    message.value = error instanceof Error ? error.message : 'Не удалось выполнить импорт'
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
        <p>Выберите один маршрут, проверьте остановки и явно укажите, что именно нужно импортировать.</p>
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
      <section class="route-picker-shell">
        <div class="section-heading">
          <div><span>1. Выберите маршрут</span><strong>Импортируется только одна выбранная карточка</strong></div>
          <small>{{ fileName }} · маршрутов в файле: {{ candidates.length }}</small>
        </div>
        <div class="route-card-grid">
          <button
            v-for="candidate in candidates"
            :key="candidate.route.lineId"
            class="route-card"
            :class="{ active: selectedLineId === candidate.route.lineId }"
            @click="selectRoute(candidate.route.lineId)"
          >
            <span class="route-card-number">{{ candidate.route.name }}</span>
            <div>
              <strong>{{ transportLabel(candidate.route.type) }}</strong>
              <small>{{ candidate.stopCount }} ост. · {{ candidate.threadCount }} напр.</small>
            </div>
            <span class="route-card-check">{{ selectedLineId === candidate.route.lineId ? 'Выбран' : 'Выбрать' }}</span>
          </button>
        </div>
      </section>

      <section class="panel import-target">
        <div class="target-copy">
          <span>2. Что импортировать</span>
          <strong>Маршрут № {{ draft.number }}</strong>
          <small>Остальные {{ Math.max(0, candidates.length - 1) }} маршрутов из файла не изменятся.</small>
        </div>
        <div class="mode-cards">
          <button
            :class="{ active: importMode === 'route-and-schedules' }"
            :disabled="!routeCanBeSaved"
            @click="importMode = 'route-and-schedules'"
          >
            <strong>Маршрут и расписания</strong>
            <span>Обновить порядок остановок, геометрию и времена выбранного маршрута.</span>
          </button>
          <button
            :class="{ active: importMode === 'schedules-only' }"
            :disabled="!schedulesCanBeUpdated"
            @click="importMode = 'schedules-only'"
          >
            <strong>Только расписания</strong>
            <span>Не менять маршрут. Обновить времена только у остановок из файла.</span>
          </button>
        </div>
        <div class="route-fields">
          <label>Номер<input v-model="draft.number" /></label>
          <label>Название<input v-model="draft.name" /></label>
        </div>
      </section>

      <section class="panel import-validation">
        <div><strong>Предварительная проверка</strong><span>{{ warnings.length }} замечаний</span></div>
        <ul><li v-for="warning in warnings" :key="warning">{{ warning }}</li></ul>
      </section>

      <section class="panel direction-tabs-section">
        <div class="section-heading">
          <div><span>3. Направление</span><strong>Проверьте порядок остановок</strong></div>
          <small>{{ draft.directions.length }} направл.</small>
        </div>
        <div class="direction-tabs">
          <button
            v-for="(item, index) in draft.directions"
            :key="item.id"
            :class="{ active: selectedDirectionIndex === index }"
            @click="selectDirection(index)"
          >
            <span>{{ index + 1 }}</span>
            <div><strong>{{ item.name }}</strong><small>{{ item.stopIds.length }} ост. · уверенность {{ item.orderingConfidence }}</small></div>
          </button>
        </div>
      </section>

      <div class="import-workspace">
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

      <section class="panel schedule-section">
        <div class="schedule-heading">
          <div><span>4. Расписание выбранного направления</span><strong>{{ direction?.name }}</strong></div>
          <div class="schedule-stats"><span>{{ direction?.stopIds.length }} остановок</span><span>{{ scheduleCount }} записей</span></div>
        </div>

        <div class="day-mode">
          <div><strong>Дни применения</strong><span>Выгрузка содержит расписание конкретной даты.</span></div>
          <div class="day-mode-buttons">
            <button :class="{ active: dayMode === 'source' }" @click="dayMode = 'source'">
              Только день из выгрузки
              <small>{{ sourceDayLabels.join(', ') || 'дата не указана' }}</small>
            </button>
            <button :class="{ active: dayMode === 'all' }" @click="dayMode = 'all'">
              Все дни недели
              <small>Применить эти же времена с Пн по Вс</small>
            </button>
          </div>
        </div>

        <div class="schedule-table">
          <article v-for="(stopId, index) in direction?.stopIds" :key="stopId" class="schedule-row">
            <div class="schedule-stop">
              <span>{{ index + 1 }}</span>
              <div><strong>{{ stopById.get(stopId)?.name ?? stopId }}</strong><small>{{ scheduleForStop(stopId) ? serviceDateLabel(scheduleForStop(stopId)!) : 'Расписание отсутствует' }}</small></div>
            </div>
            <template v-if="scheduleForStop(stopId)">
              <div class="schedule-mode"><strong>{{ scheduleModeLabel(scheduleForStop(stopId)!) }}</strong><small>threadId {{ scheduleForStop(stopId)!.threadId }}</small></div>
              <div v-if="scheduleForStop(stopId)!.scheduledTimes?.length" class="time-chip-list">
                <span v-for="time in scheduleForStop(stopId)!.scheduledTimes" :key="time">{{ time }}</span>
              </div>
              <div v-else-if="scheduleForStop(stopId)!.frequencies?.length" class="frequency-list">
                <span v-for="frequency in scheduleForStop(stopId)!.frequencies" :key="`${frequency.begin}-${frequency.end}`">
                  {{ frequency.begin }}–{{ frequency.end }} · каждые {{ Math.round(frequency.intervalSeconds / 60) }} мин
                </span>
              </div>
              <span v-else class="no-time">Времён нет</span>
            </template>
            <span v-else class="no-time">Нет записи для этой остановки</span>
          </article>
        </div>
      </section>

      <footer class="panel import-footer">
        <div>
          <strong v-if="importMode === 'route-and-schedules'">Будет импортирован только маршрут № {{ draft.number }}</strong>
          <strong v-else>Будут обновлены только расписания маршрута № {{ draft.number }}</strong>
          <span>{{ allRouteScheduleCount }} записей в выбранном маршруте · остальные маршруты не изменятся</span>
          <p v-if="message" :class="messageType === 'error' ? 'error-text' : 'success-text'">{{ message }}</p>
        </div>
        <button :disabled="importDisabled" @click="runImport">
          {{ importing ? 'Импорт…' : importMode === 'route-and-schedules' ? `Импортировать только маршрут ${draft.number}` : `Обновить только расписания ${draft.number}` }}
        </button>
      </footer>
    </template>
  </section>
</template>

<style scoped>
.stopwise-import-page { min-height: 100%; padding-bottom: 24px; }
.import-file-button { display: inline-flex; align-items: center; min-height: 42px; padding: 0 18px; background: #111827; color: #fff; cursor: pointer; font-weight: 700; }
.import-file-button input { display: none; }
.empty-import { min-height: 220px; display: grid; place-content: center; gap: 8px; text-align: center; }
.empty-import span, .section-heading span, .section-heading small, .target-copy span, .target-copy small { color: #64748b; }
.route-picker-shell { padding: 18px 18px 0; }
.section-heading { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
.section-heading > div { display: grid; gap: 3px; }
.route-card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 10px; }
.route-card { display: grid; grid-template-columns: 52px 1fr auto; align-items: center; gap: 10px; min-height: 76px; padding: 12px; text-align: left; background: #fff; color: #111827; border: 1px solid #dbe2ea; }
.route-card.active { border: 2px solid #0074dc; padding: 11px; background: #f7fbff; }
.route-card-number { min-width: 46px; height: 46px; display: grid; place-items: center; border: 2px solid #0074dc; font-size: 18px; font-weight: 800; }
.route-card > div { display: grid; gap: 4px; }
.route-card small { color: #64748b; }
.route-card-check { color: #64748b; font-size: 12px; }
.route-card.active .route-card-check { color: #0074dc; font-weight: 700; }
.import-target, .import-validation, .direction-tabs-section, .schedule-section, .import-footer { margin: 14px 18px 0; }
.import-target { display: grid; grid-template-columns: 230px minmax(420px, 1fr) minmax(260px, 430px); gap: 16px; align-items: stretch; }
.target-copy { display: grid; align-content: center; gap: 5px; }
.mode-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.mode-cards button { display: grid; gap: 5px; text-align: left; background: #fff; color: #111827; border: 1px solid #dbe2ea; padding: 12px; }
.mode-cards button.active { border-color: #0074dc; background: #f7fbff; box-shadow: inset 0 0 0 1px #0074dc; }
.mode-cards button:disabled { opacity: .45; cursor: not-allowed; }
.mode-cards span { color: #64748b; font-size: 12px; line-height: 1.35; }
.route-fields { display: grid; grid-template-columns: 90px 1fr; gap: 10px; }
.route-fields label { display: grid; gap: 5px; color: #64748b; font-size: 12px; }
.import-validation > div { display: flex; justify-content: space-between; }
.import-validation ul { margin: 10px 0 0; padding-left: 20px; color: #9a6700; }
.direction-tabs { display: flex; gap: 10px; overflow-x: auto; }
.direction-tabs button { min-width: 270px; display: flex; gap: 10px; align-items: center; text-align: left; background: #fff; color: #111827; border: 1px solid #dbe2ea; padding: 10px; }
.direction-tabs button.active { border-color: #0074dc; background: #f7fbff; }
.direction-tabs button > span { width: 30px; height: 30px; display: grid; place-items: center; background: #e8eef5; font-weight: 700; }
.direction-tabs button div { display: grid; gap: 3px; }
.direction-tabs small { color: #64748b; }
.import-workspace { display: grid; grid-template-columns: minmax(520px, 1fr) 350px; gap: 14px; min-height: 610px; margin: 14px 18px 0; }
.import-map { min-height: 610px; border: 1px solid #dbe2ea; background: #eef2f6; overflow: hidden; }
.import-map :deep(.map) { height: 100%; min-height: 610px; }
.stops-panel { overflow: auto; max-height: 610px; }
.stops-heading, .schedule-heading { display: flex; justify-content: space-between; align-items: center; gap: 14px; }
.stops-heading > div, .schedule-heading > div:first-child { display: grid; gap: 3px; }
.stops-heading span, .schedule-heading span { color: #64748b; }
.stops-panel ol { list-style: none; margin: 12px 0; padding: 0; display: grid; gap: 6px; }
.stops-panel li { display: grid; grid-template-columns: 28px 1fr auto; gap: 8px; align-items: center; padding: 8px; border: 1px solid #e2e8f0; cursor: pointer; }
.stops-panel li.selected { border-color: #0074dc; background: #f7fbff; }
.stops-panel li > span { color: #64748b; font-size: 12px; }
.stops-panel li div { display: grid; gap: 2px; min-width: 0; }
.stops-panel small { color: #64748b; }
.stop-controls { display: flex !important; gap: 4px; }
.stop-controls button { min-width: 28px; min-height: 28px; padding: 0; background: #eef2f6; color: #111827; }
.stop-controls .remove { color: #b91c1c; }
.selected-stop { display: grid; gap: 7px; padding-top: 12px; border-top: 1px solid #e2e8f0; }
.selected-stop span { color: #64748b; font-size: 12px; }
.schedule-stats { display: flex !important; gap: 8px; }
.schedule-stats span { padding: 7px 9px; background: #eef2f6; font-size: 12px; }
.day-mode { display: grid; grid-template-columns: 240px 1fr; gap: 16px; align-items: center; margin-top: 14px; padding: 12px; background: #f8fafc; border: 1px solid #e2e8f0; }
.day-mode > div:first-child { display: grid; gap: 4px; }
.day-mode > div:first-child span { color: #64748b; font-size: 12px; }
.day-mode-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.day-mode-buttons button { display: grid; gap: 3px; text-align: left; background: #fff; color: #111827; border: 1px solid #dbe2ea; padding: 10px; }
.day-mode-buttons button.active { border-color: #0074dc; background: #f7fbff; box-shadow: inset 0 0 0 1px #0074dc; }
.day-mode-buttons small { color: #64748b; }
.schedule-table { margin-top: 12px; border: 1px solid #e2e8f0; }
.schedule-row { display: grid; grid-template-columns: minmax(230px, .8fr) 190px minmax(260px, 2fr); gap: 12px; align-items: start; padding: 12px; border-bottom: 1px solid #e2e8f0; }
.schedule-row:last-child { border-bottom: 0; }
.schedule-stop { display: grid; grid-template-columns: 28px 1fr; gap: 8px; }
.schedule-stop > span { width: 28px; height: 28px; display: grid; place-items: center; background: #e8eef5; font-size: 12px; }
.schedule-stop div, .schedule-mode { display: grid; gap: 3px; }
.schedule-stop small, .schedule-mode small { color: #64748b; }
.time-chip-list { display: flex; flex-wrap: wrap; gap: 5px; }
.time-chip-list span { padding: 4px 7px; background: #eef2f6; font-variant-numeric: tabular-nums; }
.frequency-list { display: grid; gap: 5px; }
.frequency-list span { padding: 7px 9px; background: #eef2f6; }
.no-time { color: #9a6700; }
.import-footer { position: sticky; bottom: 12px; z-index: 5; display: flex; align-items: center; justify-content: space-between; gap: 18px; box-shadow: 0 8px 32px rgb(15 23 42 / 16%); }
.import-footer > div { display: grid; gap: 4px; }
.import-footer > div > span { color: #64748b; }
.import-footer button { min-width: 280px; }
.error-text { color: #b91c1c; margin: 0; }
.success-text { color: #166534; margin: 0; }
@media (max-width: 1200px) {
  .import-target { grid-template-columns: 1fr; }
  .import-workspace { grid-template-columns: 1fr; }
  .stops-panel { max-height: 420px; }
  .schedule-row { grid-template-columns: 1fr; }
  .day-mode { grid-template-columns: 1fr; }
}
</style>
