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
  routes?: ExportRoute[]
  stops?: ExportStop[]
  schedules?: ExportSchedule[]
}
type Candidate = {
  route: ExportRoute
  schedules: ExportSchedule[]
  stopCount: number
  threadCount: number
  pendingCount: number
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

const pendingPrefix = 'ostanobus-stopwise-route:'
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
    ? (existingRoutes.value.find(
        (route) => route.number.trim().toLocaleLowerCase('ru-RU') === number,
      ) ?? null)
    : null
})
const routeIsComplete = computed(
  () =>
    Boolean(draft.value?.directions.length) &&
    draft.value!.directions.every((item) => item.stopIds.length >= 2),
)
const isNewIncompleteRoute = computed(() => Boolean(draft.value && !existingRoute.value && !routeIsComplete.value))
const schedulesCanBeUpdated = computed(() => Boolean(existingRoute.value && selectedCandidate.value?.schedules.length))
const importDisabled = computed(() => {
  if (importing.value || !draft.value) return true
  if (isNewIncompleteRoute.value) return false
  return importMode.value === 'route-and-schedules' ? !routeIsComplete.value : !schedulesCanBeUpdated.value
})
const currentScheduleCount = computed(() =>
  direction.value?.sourceSchedules.reduce(
    (total, item) => total + (item.scheduledTimes?.length ?? 0) + (item.frequencies?.length ?? 0),
    0,
  ) ?? 0,
)
const allScheduleCount = computed(() =>
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
  if (isNewIncompleteRoute.value) {
    result.push(
      `Новый маршрут пока содержит ${item.stops.length} остановку. Для записи маршрута в базу нужно минимум две. Сейчас можно сохранить заготовку и добавить следующую выгрузку позже.`,
    )
  }
  if (item.directions.length < 2) {
    result.push('В выгрузке найдено только одно направление маршрута.')
  }
  for (const [index, routeDirection] of item.directions.entries()) {
    if (routeDirection.orderingConfidence !== 'high') {
      result.push(`Направление ${index + 1}: порядок остановок нужно проверить вручную.`)
    }
  }
  if (existingRoute.value) {
    result.push(`Маршрут № ${item.number} уже существует. Будет изменён только он.`)
  } else if (routeIsComplete.value) {
    result.push(`Маршрут № ${item.number} новый и будет создан после подтверждения.`)
  }
  result.push('Остальные маршруты из файла не импортируются.')
  return result
})

function generatedId(kind: 'route' | 'direction' | 'segment') {
  return `${kind}-${crypto.randomUUID()}`
}

function pendingKey(lineId: string) {
  return `${pendingPrefix}${lineId}`
}

function readPending(lineId: string): ExportPayload | null {
  try {
    const raw = localStorage.getItem(pendingKey(lineId))
    return raw ? (JSON.parse(raw) as ExportPayload) : null
  } catch {
    return null
  }
}

function scheduleKey(schedule: ExportSchedule) {
  return `${schedule.lineId}\u0000${schedule.threadId}\u0000${schedule.stopId}\u0000${schedule.serviceDate ?? ''}`
}

function mergePayload(base: ExportPayload, extra: ExportPayload | null): ExportPayload {
  if (!extra) return base
  const routes = new Map<string, ExportRoute>()
  for (const route of [...(extra.routes ?? []), ...(base.routes ?? [])]) routes.set(route.lineId, route)
  const stops = new Map<string, ExportStop>()
  for (const stop of [...(extra.stops ?? []), ...(base.stops ?? [])]) stops.set(stop.id, stop)
  const schedules = new Map<string, ExportSchedule>()
  for (const schedule of [...(extra.schedules ?? []), ...(base.schedules ?? [])]) {
    schedules.set(scheduleKey(schedule), schedule)
  }
  return {
    city: base.city ?? extra.city,
    routes: [...routes.values()],
    stops: [...stops.values()],
    schedules: [...schedules.values()],
  }
}

function mergePendingForKnownRoutes(source: ExportPayload) {
  let merged = source
  for (const route of source.routes ?? []) merged = mergePayload(merged, readPending(route.lineId))
  return merged
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
  return (source.routes ?? [])
    .map((route) => {
      const schedules = (source.schedules ?? []).filter((item) => item.lineId === route.lineId)
      const pending = readPending(route.lineId)
      return {
        route,
        schedules,
        stopCount: new Set(schedules.map((item) => item.stopId)).size,
        threadCount: new Set(schedules.map((item) => item.threadId)).size,
        pendingCount: new Set((pending?.schedules ?? []).map((item) => item.stopId)).size,
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
  const timed = schedules.filter((item) => normalizedTimes(item).length > 0).length
  return timed === schedules.length ? ('high' as const) : timed > 0 ? ('medium' as const) : ('low' as const)
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
    if (stop) {
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
  importMode.value = existingRoute.value && !routeIsComplete.value ? 'schedules-only' : 'route-and-schedules'
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
    const merged = mergePendingForKnownRoutes(parsed)
    payload.value = merged
    candidates.value = buildCandidates(merged)
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
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'long', weekday: 'short' }).format(date)
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

function matchDirection(route: Route, source: DraftDirection, mappedStopIds: string[]) {
  const byTerminal = route.directions.filter(
    (item) => normalized(item.terminal) === normalized(source.terminal) && mappedStopIds.some((id) => item.stopIds.includes(id)),
  )
  if (byTerminal.length === 1) return byTerminal[0]!
  const byStop = route.directions.filter((item) => mappedStopIds.some((id) => item.stopIds.includes(id)))
  return byStop.length === 1 ? byStop[0]! : null
}

function matchDirectionForSchedule(route: Route, source: ExportSchedule, stopId: string) {
  const byTerminal = route.directions.filter(
    (item) => item.stopIds.includes(stopId) && normalized(item.terminal) === normalized(source.destinationName),
  )
  if (byTerminal.length === 1) return byTerminal[0]!
  const byStop = route.directions.filter((item) => item.stopIds.includes(stopId))
  return byStop.length === 1 ? byStop[0]! : null
}

async function ensureStopMap(createMissing: boolean) {
  const result = new Map<string, string>()
  for (const imported of draft.value?.stops ?? []) {
    const found = findExistingStop(imported)
    if (found) {
      result.set(imported.id, found.id)
    } else if (createMissing) {
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
      result.set(imported.id, saved.id)
    }
  }
  return result
}

async function replaceStopSchedule(directionId: string, stopId: string, source: ExportSchedule) {
  const days = scheduleDays(source)
  if (!days.length) return 0
  const old = await api.schedules(directionId, stopId)
  for (const schedule of old) if (schedule.id) await api.deleteSchedule(schedule.id)
  let saved = 0
  for (const departureTime of source.scheduledTimes ?? []) {
    const record: Schedule = {
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
    await api.saveSchedule(record)
    saved += 1
  }
  for (const frequency of source.frequencies ?? []) {
    const record: Schedule = {
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
    await api.saveSchedule(record)
    saved += 1
  }
  const verified = await api.schedules(directionId, stopId)
  if (saved && !verified.length) throw new Error(`Расписание остановки ${stopId} не сохранилось`)
  return saved
}

async function buildDirection(source: DraftDirection, idMap: Map<string, string>, oldRoute: Route | null) {
  const mappedStopIds = source.stopIds.map((id) => idMap.get(id) ?? id)
  const matched = oldRoute ? matchDirection(oldRoute, source, mappedStopIds) : null
  const segments: RouteSegment[] = []
  for (let index = 0; index < source.stopIds.length - 1; index += 1) {
    const from = stopById.value.get(source.stopIds[index]!)
    const to = stopById.value.get(source.stopIds[index + 1]!)
    if (!from || !to) continue
    let geometry: GeoJSON.LineString
    let distanceMeters: number | null = null
    try {
      const built = await api.buildGeometry([
        [from.longitude, from.latitude],
        [to.longitude, to.latitude],
      ])
      geometry = built.geometry
      distanceMeters = built.distanceMeters
    } catch {
      geometry = { type: 'LineString', coordinates: [[from.longitude, from.latitude], [to.longitude, to.latitude]] }
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
    name: source.name,
    terminal: source.terminal,
    stopIds: mappedStopIds,
    roadAnchors: [],
    routeType: 'linear',
    segments,
    active: true,
  }
  return { source, direction: result, matchedId: matched?.id ?? null }
}

function savePendingDraft() {
  const candidate = selectedCandidate.value
  const source = payload.value
  if (!candidate || !source) return
  const stopIds = new Set(candidate.schedules.map((item) => item.stopId))
  const pending: ExportPayload = {
    city: source.city,
    routes: [candidate.route],
    stops: (source.stops ?? []).filter((stop) => stopIds.has(stop.id)),
    schedules: candidate.schedules,
  }
  localStorage.setItem(pendingKey(candidate.route.lineId), JSON.stringify(pending))
  messageType.value = 'success'
  message.value = `Заготовка маршрута № ${candidate.route.name} сохранена: ${stopIds.size} остановка. Загрузите файл со следующей остановкой этого маршрута — данные объединятся автоматически.`
  candidates.value = buildCandidates(source)
}

async function importRouteAndSchedules() {
  const item = draft.value
  if (!item || !routeIsComplete.value) throw new Error('Для создания маршрута нужно минимум две остановки')
  const idMap = await ensureStopMap(true)
  const oldRoute = existingRoute.value
  const imported = [] as Array<Awaited<ReturnType<typeof buildDirection>>>
  for (const source of item.directions) imported.push(await buildDirection(source, idMap, oldRoute))
  const matchedIds = new Set(imported.map((entry) => entry.matchedId).filter((id): id is string => Boolean(id)))
  const preserved = oldRoute?.directions.filter((entry) => !matchedIds.has(entry.id)) ?? []
  const routeId = oldRoute?.routeId ?? generatedId('route')
  const saved = await api.saveRoute({
    routeId,
    cityId: 'volgodonsk',
    number: item.number.trim(),
    name: item.name.trim() || null,
    color: oldRoute?.color ?? '#0074dc',
    active: true,
    isMock: false,
    directions: [...preserved, ...imported.map((entry) => entry.direction)],
  })
  const refreshed = await api.routes()
  const verifiedRoute = refreshed.find((route) => route.routeId === saved.routeId)
  if (!verifiedRoute) throw new Error('Сервер принял запрос, но маршрут не появился в списке маршрутов')
  let savedSchedules = 0
  let touchedStops = 0
  for (const entry of imported) {
    for (const source of entry.source.sourceSchedules) {
      const stopId = idMap.get(source.stopId)
      if (!stopId) continue
      savedSchedules += await replaceStopSchedule(entry.direction.id, stopId, source)
      touchedStops += 1
    }
  }
  localStorage.removeItem(pendingKey(item.sourceLineId))
  existingRoutes.value = refreshed
  return { routeId: saved.routeId, savedSchedules, touchedStops, directions: imported.length }
}

async function importSchedulesOnly() {
  const route = existingRoute.value
  if (!route) throw new Error('Маршрут с таким номером не найден')
  const idMap = await ensureStopMap(false)
  let savedSchedules = 0
  let touchedStops = 0
  let skipped = 0
  for (const routeDirection of draft.value?.directions ?? []) {
    for (const source of routeDirection.sourceSchedules) {
      const stopId = idMap.get(source.stopId)
      if (!stopId) {
        skipped += 1
        continue
      }
      const target = matchDirectionForSchedule(route, source, stopId)
      if (!target) {
        skipped += 1
        continue
      }
      savedSchedules += await replaceStopSchedule(target.id, stopId, source)
      touchedStops += 1
    }
  }
  return { savedSchedules, touchedStops, skipped }
}

async function runImport() {
  if (importDisabled.value || !draft.value) return
  if (isNewIncompleteRoute.value) {
    savePendingDraft()
    return
  }
  importing.value = true
  message.value = ''
  try {
    if (importMode.value === 'route-and-schedules') {
      const result = await importRouteAndSchedules()
      message.value = `Маршрут № ${draft.value.number} создан и проверен в базе: ${result.directions} направлений, ${result.touchedStops} остановок с расписанием, ${result.savedSchedules} записей.`
    } else {
      const result = await importSchedulesOnly()
      message.value = `Расписание маршрута № ${draft.value.number} обновлено: ${result.touchedStops} остановок, ${result.savedSchedules} записей${result.skipped ? `, пропущено ${result.skipped}` : ''}.`
    }
    messageType.value = 'success'
    existingStops.value = await api.stops()
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
  <section class="editor-page stopwise-page">
    <header class="page-header">
      <div>
        <h1>Импорт по остановкам</h1>
        <p>Выберите один маршрут. Новые поостановочные выгрузки одной линии объединяются автоматически.</p>
      </div>
      <label class="file-button"><input type="file" accept="application/json,.json" @change="readFile" />Выбрать JSON</label>
    </header>

    <div v-if="!payload" class="panel empty-state">
      <strong>Загрузите ostanobus_export.json</strong>
      <span>Для нового маршрута можно последовательно загружать остановки: первая сохранится как заготовка.</span>
      <p v-if="message" class="error-text">{{ message }}</p>
    </div>

    <template v-else-if="draft">
      <section class="route-picker">
        <div class="section-title">
          <div><span>1. Выберите маршрут</span><strong>Импортируется только выбранная карточка</strong></div>
          <small>{{ fileName }}</small>
        </div>
        <div class="route-grid">
          <button
            v-for="candidate in candidates"
            :key="candidate.route.lineId"
            class="route-card"
            :class="{ active: selectedLineId === candidate.route.lineId }"
            @click="selectRoute(candidate.route.lineId)"
          >
            <span class="route-number">{{ candidate.route.name }}</span>
            <div>
              <strong>{{ transportLabel(candidate.route.type) }}</strong>
              <small>{{ candidate.stopCount }} ост. · {{ candidate.threadCount }} напр.</small>
              <small v-if="candidate.pendingCount">В заготовке: {{ candidate.pendingCount }} ост.</small>
            </div>
            <span>{{ selectedLineId === candidate.route.lineId ? 'Выбран' : 'Выбрать' }}</span>
          </button>
        </div>
      </section>

      <section class="panel target-panel">
        <div>
          <span>2. Действие</span>
          <strong>Маршрут № {{ draft.number }}</strong>
          <small v-if="existingRoute">Маршрут уже существует в базе.</small>
          <small v-else-if="routeIsComplete">Новый маршрут готов к созданию.</small>
          <small v-else>Новый маршрут пока неполный — будет сохранена заготовка.</small>
        </div>
        <div v-if="!isNewIncompleteRoute" class="mode-grid">
          <button :class="{ active: importMode === 'route-and-schedules' }" :disabled="!routeIsComplete" @click="importMode = 'route-and-schedules'">
            <strong>{{ existingRoute ? 'Маршрут и расписания' : 'Создать маршрут и расписания' }}</strong>
            <span>Записать порядок остановок, геометрию и времена.</span>
          </button>
          <button :class="{ active: importMode === 'schedules-only' }" :disabled="!schedulesCanBeUpdated" @click="importMode = 'schedules-only'">
            <strong>Только расписания</strong>
            <span>Не менять маршрут, обновить только времена.</span>
          </button>
        </div>
        <div class="fields"><label>Номер<input v-model="draft.number" /></label><label>Название<input v-model="draft.name" /></label></div>
      </section>

      <section class="panel validation"><strong>Проверка</strong><ul><li v-for="warning in warnings" :key="warning">{{ warning }}</li></ul></section>

      <section class="panel directions">
        <div class="section-title"><div><span>3. Направление</span><strong>Проверьте порядок остановок</strong></div></div>
        <div class="direction-grid">
          <button v-for="(item, index) in draft.directions" :key="item.id" :class="{ active: selectedDirectionIndex === index }" @click="selectDirection(index)">
            <span>{{ index + 1 }}</span><div><strong>{{ item.name }}</strong><small>{{ item.stopIds.length }} ост. · {{ item.orderingConfidence }}</small></div>
          </button>
        </div>
      </section>

      <div class="workspace-grid">
        <div class="map-wrap">
          <TransitMap :stops="draft.stops" :segments="direction?.segments" :selected-stop-id="selectedStopId" :selected-stop-ids="direction?.stopIds" route-color="#0074dc" @stop-click="selectedStopId = $event.id" />
        </div>
        <aside class="panel stops-panel">
          <div class="section-title"><div><span>Порядок</span><strong>{{ direction?.name }}</strong></div></div>
          <ol>
            <li v-for="(stopId, index) in direction?.stopIds" :key="stopId" :class="{ selected: selectedStopId === stopId }" @click="selectedStopId = stopId">
              <span>{{ index + 1 }}</span><div><strong>{{ stopById.get(stopId)?.name ?? stopId }}</strong><small>{{ stopId }}</small></div>
              <div class="stop-actions"><button :disabled="index === 0" @click.stop="moveStop(index, -1)">↑</button><button :disabled="index === (direction?.stopIds.length ?? 0) - 1" @click.stop="moveStop(index, 1)">↓</button><button class="remove" @click.stop="removeStop(stopId)">×</button></div>
            </li>
          </ol>
          <div v-if="selectedStop" class="selected-stop"><strong>{{ selectedStop.name }}</strong><span>{{ selectedStop.longitude.toFixed(6) }}, {{ selectedStop.latitude.toFixed(6) }}</span></div>
        </aside>
      </div>

      <section class="panel schedule-panel">
        <div class="section-title"><div><span>4. Расписание</span><strong>{{ direction?.name }}</strong></div><small>{{ currentScheduleCount }} записей</small></div>
        <div class="day-grid">
          <button :class="{ active: dayMode === 'source' }" @click="dayMode = 'source'"><strong>День из выгрузки</strong><small>{{ sourceDayLabels.join(', ') || 'Дата не указана' }}</small></button>
          <button :class="{ active: dayMode === 'all' }" @click="dayMode = 'all'"><strong>Все дни недели</strong><small>Пн–Вс</small></button>
        </div>
        <div class="schedule-list">
          <article v-for="(stopId, index) in direction?.stopIds" :key="stopId">
            <div><span>{{ index + 1 }}</span><strong>{{ stopById.get(stopId)?.name ?? stopId }}</strong></div>
            <template v-if="scheduleForStop(stopId)">
              <small>{{ serviceDateLabel(scheduleForStop(stopId)!) }} · {{ scheduleModeLabel(scheduleForStop(stopId)!) }}</small>
              <div v-if="scheduleForStop(stopId)!.scheduledTimes?.length" class="chips"><span v-for="time in scheduleForStop(stopId)!.scheduledTimes" :key="time">{{ time }}</span></div>
              <div v-else class="chips"><span v-for="frequency in scheduleForStop(stopId)!.frequencies ?? []" :key="`${frequency.begin}-${frequency.end}`">{{ frequency.begin }}–{{ frequency.end }}, {{ Math.round(frequency.intervalSeconds / 60) }} мин</span></div>
            </template>
            <small v-else>Расписание отсутствует</small>
          </article>
        </div>
      </section>

      <footer class="panel footer-panel">
        <div>
          <strong v-if="isNewIncompleteRoute">Маршрут ещё не попадёт в базу: сохранится заготовка из {{ draft.stops.length }} остановки</strong>
          <strong v-else-if="importMode === 'route-and-schedules'">{{ existingRoute ? 'Будет обновлён' : 'Будет создан' }} только маршрут № {{ draft.number }}</strong>
          <strong v-else>Будут обновлены только расписания маршрута № {{ draft.number }}</strong>
          <span>{{ allScheduleCount }} записей расписания · остальные маршруты не изменятся</span>
          <p v-if="message" :class="messageType === 'error' ? 'error-text' : 'success-text'">{{ message }}</p>
        </div>
        <button :disabled="importDisabled" @click="runImport">
          {{ importing ? 'Импорт…' : isNewIncompleteRoute ? 'Сохранить заготовку' : importMode === 'route-and-schedules' ? `${existingRoute ? 'Обновить' : 'Создать'} маршрут ${draft.number}` : `Обновить расписания ${draft.number}` }}
        </button>
      </footer>
    </template>
  </section>
</template>

<style scoped>
.stopwise-page { min-height: 100%; padding-bottom: 24px; }
.file-button { display: inline-flex; align-items: center; min-height: 42px; padding: 0 18px; background: #111827; color: white; font-weight: 700; cursor: pointer; }
.file-button input { display: none; }
.empty-state { min-height: 220px; display: grid; place-content: center; gap: 8px; text-align: center; }
.route-picker { padding: 18px 22px 0; }
.section-title { display: flex; justify-content: space-between; align-items: end; gap: 16px; margin-bottom: 12px; }
.section-title > div { display: grid; gap: 3px; }
.section-title span, .section-title small, .target-panel small, .target-panel > div > span { color: #64748b; font-size: 12px; }
.route-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 10px; }
.route-card { min-height: 92px; display: grid; grid-template-columns: 52px 1fr auto; gap: 12px; align-items: center; text-align: left; background: white; color: #111827; border: 1px solid #dbe2ea; padding: 12px; }
.route-card.active { border: 2px solid #0074dc; background: #f4f9ff; }
.route-number { display: grid; place-items: center; min-height: 48px; background: #111827; color: white; font-size: 20px; font-weight: 800; }
.route-card div { display: grid; gap: 3px; }
.route-card > span:last-child { color: #0074dc; font-size: 12px; font-weight: 700; }
.target-panel { display: grid; grid-template-columns: 220px 1fr minmax(260px, 420px); gap: 16px; align-items: end; margin-top: 14px; }
.target-panel > div:first-child { display: grid; gap: 4px; }
.mode-grid, .day-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.mode-grid button, .day-grid button, .direction-grid button { background: white; color: #111827; border: 1px solid #dbe2ea; text-align: left; padding: 12px; }
.mode-grid button.active, .day-grid button.active, .direction-grid button.active { border-color: #0074dc; background: #f4f9ff; }
.mode-grid button { display: grid; gap: 4px; }
.mode-grid span, .day-grid small, .direction-grid small { color: #64748b; }
.fields { display: grid; grid-template-columns: 110px 1fr; gap: 10px; }
.fields label { display: grid; gap: 5px; color: #64748b; font-size: 12px; }
.validation { margin-top: 14px; }
.validation ul { margin: 8px 0 0; padding-left: 20px; color: #9a6700; }
.directions { margin-top: 14px; }
.direction-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 8px; }
.direction-grid button { display: flex; gap: 10px; align-items: center; }
.direction-grid button > span { display: grid; place-items: center; width: 30px; height: 30px; background: #e2e8f0; }
.direction-grid button div { display: grid; gap: 3px; }
.workspace-grid { display: grid; grid-template-columns: minmax(500px, 1fr) 360px; gap: 14px; margin-top: 14px; min-height: 620px; }
.map-wrap { min-height: 620px; border: 1px solid #dbe2ea; overflow: hidden; }
.map-wrap :deep(.map) { min-height: 620px; height: 100%; }
.stops-panel { min-height: 0; overflow: auto; }
.stops-panel ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.stops-panel li { display: grid; grid-template-columns: 26px 1fr auto; gap: 8px; align-items: center; padding: 9px; border: 1px solid #e2e8f0; cursor: pointer; }
.stops-panel li.selected { border-color: #0074dc; background: #f4f9ff; }
.stops-panel li div:nth-child(2) { display: grid; gap: 2px; }
.stops-panel small { color: #64748b; }
.stop-actions { display: flex; gap: 3px; }
.stop-actions button { min-width: 28px; min-height: 28px; padding: 0; background: white; color: #334155; border: 1px solid #cbd5e1; }
.stop-actions .remove { color: #b91c1c; }
.selected-stop { display: grid; gap: 5px; margin-top: 12px; padding-top: 12px; border-top: 1px solid #e2e8f0; }
.selected-stop span { color: #64748b; font-size: 12px; }
.schedule-panel { margin-top: 14px; }
.day-grid { max-width: 620px; margin-bottom: 12px; }
.day-grid button { display: grid; gap: 4px; }
.schedule-list { display: grid; gap: 7px; }
.schedule-list article { display: grid; grid-template-columns: minmax(220px, 0.8fr) 180px 1fr; gap: 12px; align-items: start; padding: 10px; border: 1px solid #e2e8f0; }
.schedule-list article > div:first-child { display: flex; gap: 9px; }
.schedule-list article > div:first-child span { color: #64748b; }
.schedule-list small { color: #64748b; }
.chips { display: flex; flex-wrap: wrap; gap: 5px; }
.chips span { padding: 4px 7px; background: #eef2f6; font-size: 12px; }
.footer-panel { position: sticky; bottom: 0; z-index: 5; display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-top: 14px; box-shadow: 0 -8px 24px rgba(15, 23, 42, 0.08); }
.footer-panel > div { display: grid; gap: 4px; }
.footer-panel > div > span { color: #64748b; font-size: 12px; }
.error-text { color: #b91c1c; }
.success-text { color: #166534; }
@media (max-width: 1100px) {
  .target-panel { grid-template-columns: 1fr; }
  .workspace-grid { grid-template-columns: 1fr; }
  .stops-panel { max-height: 480px; }
}
</style>
