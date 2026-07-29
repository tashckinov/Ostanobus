<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { api } from '../api'
import StopScheduleEditor from '../components/StopScheduleEditor.vue'
import TransitMap from '../components/TransitMap.vue'
import type { Direction, Route, RouteSegment, Schedule, Stop } from '../types'

const routes = ref<Route[]>([])
const stops = ref<Stop[]>([])
const edited = ref<Route | null>(null)
const directionIndex = ref(0)
const selectedSegmentId = ref<string | null>(null)
const selectedMapStopId = ref<string | null>(null)
const roadAnchorEditingStopId = ref<string | null>(null)
const rightPanelMode = ref<'order' | 'schedule'>('order')
const mapMode = ref<'select' | 'via' | 'manual'>('select')
const manualDraftCoordinates = ref<number[][]>([])
const saving = ref(false)
const routing = ref(false)
const rebuildingAll = ref(false)
const rebuildProgress = ref('')
const loading = ref(true)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const dragStopIndex = ref<number | null>(null)
const travelMinutesBySegmentId = ref(new Map<string, number | null>())
let travelTimesRequest = 0

const direction = computed(() => edited.value?.directions[directionIndex.value] ?? null)
const stopById = computed(() => new Map(stops.value.map((stop) => [stop.id, stop])))
const selectedSegment = computed(
  () => direction.value?.segments.find((segment) => segment.id === selectedSegmentId.value) ?? null,
)
const routeSequence = computed(() => {
  const item = direction.value
  if (!item) return []

  return item.stopIds.flatMap((stopId, index) => {
    const nextStopId =
      item.stopIds[index + 1] ?? (item.routeType === 'circular' ? item.stopIds[0] : null)
    const segment = nextStopId
      ? item.segments.find(
          (candidate) => candidate.fromStopId === stopId && candidate.toStopId === nextStopId,
        )
      : null
    return [
      { type: 'stop' as const, key: `stop:${stopId}`, stopId, index },
      ...(segment
        ? [{ type: 'segment' as const, key: `segment:${segment.id}`, segment, index }]
        : []),
    ]
  })
})
const selectedMapStop = computed(() =>
  selectedMapStopId.value ? (stopById.value.get(selectedMapStopId.value) ?? null) : null,
)
const selectedMapRoadAnchor = computed(() =>
  direction.value?.roadAnchors.find((anchor) => anchor.stopId === selectedMapStopId.value),
)
const selectedMapStopIsInRoute = computed(() =>
  Boolean(direction.value?.stopIds.includes(selectedMapStopId.value ?? '')),
)
const selectedStopHasCustomAnchor = computed(() => selectedMapRoadAnchor.value !== undefined)
const activeRoadAnchor = computed(() => {
  const stop = selectedMapStop.value
  const anchor = selectedMapRoadAnchor.value
  if (!stop || !anchor || roadAnchorEditingStopId.value !== stop.id) return null
  return {
    stopId: stop.id,
    longitude: anchor.longitude,
    latitude: anchor.latitude,
  }
})
const roadAnchors = computed(() => direction.value?.roadAnchors ?? [])
const segmentViaPoints = computed(() =>
  (direction.value?.segments ?? []).flatMap((segment) =>
    segment.viaPoints.map((point) => ({ ...point, segmentId: segment.id })),
  ),
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

function generatedId(kind: 'route' | 'direction' | 'segment') {
  return `${kind}-${crypto.randomUUID()}`
}

function expectedPairs(stopIds: string[], routeType: Direction['routeType']) {
  const pairs = stopIds.slice(0, -1).map((stopId, index) => [stopId, stopIds[index + 1]!] as const)
  if (routeType === 'circular' && stopIds.length > 1) {
    pairs.push([stopIds.at(-1)!, stopIds[0]!] as const)
  }
  return pairs
}

function blankSegment(fromStopId: string, toStopId: string): RouteSegment {
  return {
    id: generatedId('segment'),
    fromStopId,
    toStopId,
    mode: 'automatic',
    status: 'error',
    viaPoints: [],
    geometry: null,
    distanceMeters: null,
  }
}

function rebuildSegments(item: Direction) {
  const existing = new Map(
    item.segments.map((segment) => [`${segment.fromStopId}\u0000${segment.toStopId}`, segment]),
  )
  item.segments = expectedPairs(item.stopIds, item.routeType).map(
    ([fromStopId, toStopId]) =>
      existing.get(`${fromStopId}\u0000${toStopId}`) ?? blankSegment(fromStopId, toStopId),
  )
  if (!item.segments.some((segment) => segment.id === selectedSegmentId.value)) {
    selectedSegmentId.value = null
  }
}

function normalizeDirection(item: Direction): Direction {
  const normalized = {
    ...item,
    routeType: item.routeType ?? 'linear',
    segments: item.segments ?? [],
    roadAnchors: (item.roadAnchors ?? []).filter((anchor) => item.stopIds.includes(anchor.stopId)),
  }
  rebuildSegments(normalized)
  return normalized
}

function newDirection(): Direction {
  return {
    id: generatedId('direction'),
    name: '',
    terminal: '',
    stopIds: [],
    roadAnchors: [],
    routeType: 'linear',
    segments: [],
    active: true,
  }
}

function showMessage(text: string, type: 'success' | 'error' = 'success') {
  message.value = text
  messageType.value = type
}

function resetTools() {
  selectedSegmentId.value = null
  selectedMapStopId.value = null
  roadAnchorEditingStopId.value = null
  rightPanelMode.value = 'order'
  mapMode.value = 'select'
  manualDraftCoordinates.value = []
}

function cloneRoute(route: Route) {
  const copy = JSON.parse(JSON.stringify(route)) as Route
  copy.directions = copy.directions.map(normalizeDirection)
  edited.value = copy
  directionIndex.value = 0
  resetTools()
  message.value = ''
  void refreshTravelTimes()
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
  resetTools()
  message.value = ''
  travelMinutesBySegmentId.value = new Map()
}

function backToRoutes() {
  edited.value = null
  directionIndex.value = 0
  resetTools()
  message.value = ''
}

function addDirection() {
  if (!edited.value) return
  edited.value.directions.push(newDirection())
  directionIndex.value = edited.value.directions.length - 1
  resetTools()
  void refreshTravelTimes()
}

function removeDirection() {
  if (!edited.value || edited.value.directions.length <= 1) return
  if (!confirm('Удалить это направление?')) return
  edited.value.directions.splice(directionIndex.value, 1)
  directionIndex.value = Math.max(0, directionIndex.value - 1)
  resetTools()
  void refreshTravelTimes()
}

function changeDirection(index: number) {
  directionIndex.value = index
  resetTools()
  void refreshTravelTimes()
}

function setRouteType(routeType: Direction['routeType']) {
  if (!direction.value || direction.value.routeType === routeType) return
  direction.value.routeType = routeType
  rebuildSegments(direction.value)
  void refreshTravelTimes()
  showMessage(
    routeType === 'circular'
      ? 'Добавлен явный замыкающий сегмент от B к A'
      : 'Замыкающий сегмент удалён, направление линейное',
  )
}

function handleRouteTypeChange(event: Event) {
  setRouteType((event.target as HTMLSelectElement).value as Direction['routeType'])
}

function selectMapStop(stop: Stop) {
  selectedMapStopId.value = stop.id
  roadAnchorEditingStopId.value = null
  rightPanelMode.value = 'order'
}

function selectSegment(segmentId: string) {
  if (
    selectedSegmentId.value === segmentId &&
    selectedMapStopId.value === null &&
    roadAnchorEditingStopId.value === null &&
    rightPanelMode.value === 'order'
  ) {
    return
  }
  selectedSegmentId.value = segmentId
  selectedMapStopId.value = null
  roadAnchorEditingStopId.value = null
  rightPanelMode.value = 'order'
  mapMode.value = 'select'
  manualDraftCoordinates.value = []
}

function closeStopMenu() {
  selectedMapStopId.value = null
  roadAnchorEditingStopId.value = null
}

function rebuildRoadAnchors(item: Direction) {
  item.roadAnchors = item.roadAnchors.filter((anchor) => item.stopIds.includes(anchor.stopId))
}

function addSelectedStop() {
  const stop = selectedMapStop.value
  const item = direction.value
  if (!item || !stop) return
  if (item.stopIds.includes(stop.id)) {
    showMessage('Эта остановка уже есть в направлении', 'error')
    return
  }
  const selected = selectedSegment.value
  const fromIndex = selected ? item.stopIds.indexOf(selected.fromStopId) : -1
  const insertAt = fromIndex >= 0 ? fromIndex + 1 : item.stopIds.length
  item.stopIds.splice(insertAt, 0, stop.id)
  rebuildRoadAnchors(item)
  rebuildSegments(item)
  showMessage(
    selected
      ? `Остановка «${stop.name}» вставлена в выбранный сегмент`
      : `Остановка «${stop.name}» добавлена в конец направления`,
  )
}

function removeSelectedStop() {
  const stop = selectedMapStop.value
  const item = direction.value
  if (!item || !stop) return
  item.stopIds = item.stopIds.filter((stopId) => stopId !== stop.id)
  rebuildRoadAnchors(item)
  rebuildSegments(item)
  resetTools()
  showMessage(`Остановка «${stop.name}» удалена из направления`)
}

function removeStopById(stopId: string) {
  selectedMapStopId.value = stopId
  removeSelectedStop()
}

function moveStop(index: number, delta: number) {
  const item = direction.value
  if (!item) return
  const next = index + delta
  if (next < 0 || next >= item.stopIds.length) return
  const [stopId] = item.stopIds.splice(index, 1)
  if (!stopId) return
  item.stopIds.splice(next, 0, stopId)
  rebuildRoadAnchors(item)
  rebuildSegments(item)
}

function dropStop(targetIndex: number) {
  const item = direction.value
  if (!item || dragStopIndex.value === null || dragStopIndex.value === targetIndex) return
  const [stopId] = item.stopIds.splice(dragStopIndex.value, 1)
  if (!stopId) return
  item.stopIds.splice(targetIndex, 0, stopId)
  dragStopIndex.value = null
  rebuildRoadAnchors(item)
  rebuildSegments(item)
}

function beginRoadAnchorEditing() {
  const stop = selectedMapStop.value
  const item = direction.value
  if (!stop || !item) return
  if (!selectedMapRoadAnchor.value) {
    item.roadAnchors.push({
      stopId: stop.id,
      longitude: stop.longitude,
      latitude: stop.latitude,
    })
  }
  roadAnchorEditingStopId.value = stop.id
  showMessage('Перетащите дорожный якорь на место остановки автобуса на дороге')
}

function finishRoadAnchorEditing() {
  roadAnchorEditingStopId.value = null
  showMessage('Дорожный якорь сохранится вместе с маршрутом')
}

function invalidateAdjacentSegments(stopId: string) {
  const item = direction.value
  if (!item) return
  for (const segment of item.segments) {
    if (
      segment.status !== 'fixed' &&
      (segment.fromStopId === stopId || segment.toStopId === stopId)
    ) {
      segment.geometry = null
      segment.distanceMeters = null
      segment.status = 'error'
    }
  }
}

function moveRoadAnchor(stopId: string, longitude: number, latitude: number) {
  const anchor = direction.value?.roadAnchors.find((item) => item.stopId === stopId)
  if (!anchor) return
  anchor.longitude = longitude
  anchor.latitude = latitude
  invalidateAdjacentSegments(stopId)
  void rebuildAdjacentSegments(stopId)
}

function resetRoadAnchor() {
  const anchor = selectedMapRoadAnchor.value
  const item = direction.value
  if (!anchor || !item) return
  item.roadAnchors = item.roadAnchors.filter((candidate) => candidate.stopId !== anchor.stopId)
  roadAnchorEditingStopId.value = null
  invalidateAdjacentSegments(anchor.stopId)
  showMessage('Дорожный якорь возвращён к координатам остановки')
}

function segmentEndpoint(stopId: string) {
  const anchor = direction.value?.roadAnchors.find((item) => item.stopId === stopId)
  if (anchor) {
    return [anchor.longitude, anchor.latitude]
  }
  const stop = stopById.value.get(stopId)
  return stop ? [stop.longitude, stop.latitude] : null
}

async function buildSegment(segment: RouteSegment) {
  if (segment.status === 'fixed') return false
  const start = segmentEndpoint(segment.fromStopId)
  const end = segmentEndpoint(segment.toStopId)
  if (!start || !end) return false

  routing.value = true
  try {
    const result = await api.buildGeometry([
      start,
      ...segment.viaPoints.map((point) => [point.longitude, point.latitude]),
      end,
    ])
    segment.geometry = result.geometry
    segment.distanceMeters = result.distanceMeters
    segment.mode = 'automatic'
    segment.status = 'draft'
    return true
  } catch (error) {
    segment.status = 'error'
    showMessage(error instanceof Error ? error.message : 'Не удалось построить сегмент', 'error')
    return false
  } finally {
    routing.value = false
  }
}

async function buildSelectedSegment() {
  const segment = selectedSegment.value
  if (!segment) return
  if (segment.status === 'fixed') {
    showMessage('Сначала снимите фиксацию сегмента', 'error')
    return
  }

  const built = await buildSegment(segment)
  if (built) {
    showMessage(`Построен выбранный отрезок: ${Math.round(segment.distanceMeters ?? 0)} м`)
  }
}

function beginViaMode() {
  const segment = selectedSegment.value
  if (!segment) return
  if (segment.status === 'fixed') {
    showMessage('Сначала снимите фиксацию сегмента', 'error')
    return
  }
  mapMode.value = 'via'
  showMessage('Поставьте промежуточную точку внутри выбранного отрезка')
}

async function handleMapClick(longitude: number, latitude: number) {
  const segment = selectedSegment.value
  if (!segment) return
  if (mapMode.value === 'via') {
    segment.viaPoints.push({ longitude, latitude })
    mapMode.value = 'select'
    await buildSelectedSegment()
    return
  }
  if (mapMode.value === 'manual') {
    manualDraftCoordinates.value.push([longitude, latitude])
  }
}

function removeVia(index: number) {
  const segment = selectedSegment.value
  if (!segment || segment.status === 'fixed') return
  segment.viaPoints.splice(index, 1)
  segment.geometry = null
  segment.distanceMeters = null
  segment.status = 'error'
}

function beginManualDrawing() {
  const segment = selectedSegment.value
  if (!segment) return
  if (segment.status === 'fixed') {
    showMessage('Сначала снимите фиксацию сегмента', 'error')
    return
  }
  const start = segmentEndpoint(segment.fromStopId)
  if (!start) return
  mapMode.value = 'manual'
  manualDraftCoordinates.value = [start]
  showMessage('Ставьте точки ручной линии по порядку, затем нажмите «Завершить линию»')
}

function lineDistance(coordinates: number[][]) {
  const radians = (value: number) => (value * Math.PI) / 180
  let total = 0
  for (let index = 1; index < coordinates.length; index += 1) {
    const left = coordinates[index - 1]!
    const right = coordinates[index]!
    const latitudeDelta = radians((right[1] ?? 0) - (left[1] ?? 0))
    const longitudeDelta = radians((right[0] ?? 0) - (left[0] ?? 0))
    const latitude = radians(((left[1] ?? 0) + (right[1] ?? 0)) / 2)
    total += 6_371_000 * Math.sqrt(latitudeDelta ** 2 + (Math.cos(latitude) * longitudeDelta) ** 2)
  }
  return Math.round(total)
}

function finishManualDrawing() {
  const segment = selectedSegment.value
  if (!segment) return
  const end = segmentEndpoint(segment.toStopId)
  if (!end || manualDraftCoordinates.value.length < 1) return
  const coordinates = [...manualDraftCoordinates.value, end]
  segment.geometry = { type: 'LineString', coordinates }
  segment.distanceMeters = lineDistance(coordinates)
  segment.mode = 'manual'
  segment.status = 'draft'
  segment.viaPoints = []
  manualDraftCoordinates.value = []
  mapMode.value = 'select'
  showMessage('Ручная геометрия сохранена как черновик')
}

function cancelManualDrawing() {
  manualDraftCoordinates.value = []
  mapMode.value = 'select'
}

function toggleSegmentFixed() {
  const segment = selectedSegment.value
  if (!segment) return
  if (segment.status === 'fixed') {
    if (segment.mode === 'automatic') {
      segment.geometry = null
      segment.distanceMeters = null
      segment.status = 'error'
      showMessage('Фиксация снята. Автоматический отрезок нужно построить заново.')
    } else {
      segment.status = 'draft'
      showMessage('Фиксация снята. Ручную линию можно изменить.')
    }
    return
  }
  if (!segment.geometry) {
    showMessage('Сначала постройте или нарисуйте отрезок', 'error')
    return
  }
  segment.status = 'fixed'
  showMessage('Отрезок проверен и зафиксирован')
}

function clearSelectedSegment() {
  const segment = selectedSegment.value
  if (!segment || segment.status === 'fixed') return
  segment.geometry = null
  segment.distanceMeters = null
  segment.viaPoints = []
  segment.status = 'error'
}

async function rebuildAllSegments() {
  const item = direction.value
  if (!item || rebuildingAll.value) return

  rebuildingAll.value = true
  let rebuilt = 0
  let skipped = 0
  try {
    for (let index = 0; index < item.segments.length; index += 1) {
      const segment = item.segments[index]!
      rebuildProgress.value = `Строим отрезок ${index + 1} из ${item.segments.length}…`
      if (segment.status === 'fixed') {
        skipped += 1
      } else if (await buildSegment(segment)) {
        rebuilt += 1
      } else {
        skipped += 1
      }
    }
    showMessage(`Маршрут перестроен: ${rebuilt}, пропущено: ${skipped}`)
  } finally {
    rebuildingAll.value = false
    rebuildProgress.value = ''
  }
}

async function rebuildAdjacentSegments(stopId: string) {
  const item = direction.value
  if (!item) return
  const adjacent = item.segments.filter(
    (segment) =>
      segment.status !== 'fixed' && (segment.fromStopId === stopId || segment.toStopId === stopId),
  )
  let rebuilt = 0
  for (const segment of adjacent) {
    if (await buildSegment(segment)) rebuilt += 1
  }
  showMessage(
    rebuilt === adjacent.length
      ? `Дорожный якорь перемещён. Автоматически перестроено участков: ${rebuilt}.`
      : `Якорь перемещён. Перестроено ${rebuilt} из ${adjacent.length} участков.`,
  )
}

function segmentName(segment: RouteSegment) {
  const from = stopById.value.get(segment.fromStopId)?.name ?? segment.fromStopId
  const to = stopById.value.get(segment.toStopId)?.name ?? segment.toStopId
  return `${from} → ${to}`
}

function segmentStatus(segment: RouteSegment) {
  if (segment.status === 'fixed') return 'Зафиксирован'
  if (!segment.geometry || segment.status === 'error') return 'Не построен'
  return segment.mode === 'manual' ? 'Ручной черновик' : 'Автоматический черновик'
}

function parseTime(value: string | null) {
  if (!value) return null
  const [hours, minutes] = value.split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  return (hours ?? 0) * 60 + (minutes ?? 0)
}

function positiveDifference(from: number, to: number) {
  let difference = to - from
  if (difference < -720) difference += 1440
  return difference > 0 && difference <= 180 ? difference : null
}

function median(values: number[]) {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

function estimateTravelMinutes(schedules: Schedule[], fromStopId: string, toStopId: string) {
  const active = schedules.filter((schedule) => schedule.active !== false)
  const fromExact = active.filter(
    (schedule) => schedule.stopId === fromStopId && schedule.type === 'exact',
  )
  const toExact = active.filter(
    (schedule) => schedule.stopId === toStopId && schedule.type === 'exact',
  )
  const exactDifferences: number[] = []

  for (const day of [1, 2, 3, 4, 5, 6, 7]) {
    const fromTimes = fromExact
      .filter((schedule) => schedule.days.includes(day))
      .map((schedule) => parseTime(schedule.departureTime))
      .filter((time): time is number => time !== null)
      .sort((left, right) => left - right)
    const toTimes = toExact
      .filter((schedule) => schedule.days.includes(day))
      .map((schedule) => parseTime(schedule.departureTime))
      .filter((time): time is number => time !== null)
      .sort((left, right) => left - right)

    for (let index = 0; index < Math.min(fromTimes.length, toTimes.length); index += 1) {
      const difference = positiveDifference(fromTimes[index]!, toTimes[index]!)
      if (difference !== null) exactDifferences.push(difference)
    }
  }

  const exactMedian = median(exactDifferences)
  if (exactMedian !== null) return exactMedian

  const fromIntervals = active.filter(
    (schedule) => schedule.stopId === fromStopId && schedule.type === 'interval',
  )
  const toIntervals = active.filter(
    (schedule) => schedule.stopId === toStopId && schedule.type === 'interval',
  )
  const intervalDifferences: number[] = []
  for (const from of fromIntervals) {
    for (const to of toIntervals) {
      if (!from.days.some((day) => to.days.includes(day))) continue
      if (from.headwayMinutes && to.headwayMinutes && from.headwayMinutes !== to.headwayMinutes) {
        continue
      }
      const fromStart = parseTime(from.startTime)
      const toStart = parseTime(to.startTime)
      if (fromStart === null || toStart === null) continue
      const difference = positiveDifference(fromStart, toStart)
      if (difference !== null) intervalDifferences.push(difference)
    }
  }
  return median(intervalDifferences)
}

async function refreshTravelTimes() {
  const item = direction.value
  const requestId = ++travelTimesRequest
  if (!item) {
    travelMinutesBySegmentId.value = new Map()
    return
  }
  try {
    const schedules = await api.schedules(item.id)
    if (requestId !== travelTimesRequest || direction.value?.id !== item.id) return
    travelMinutesBySegmentId.value = new Map(
      item.segments.map((segment) => [
        segment.id,
        estimateTravelMinutes(schedules, segment.fromStopId, segment.toStopId),
      ]),
    )
  } catch {
    if (requestId === travelTimesRequest) {
      travelMinutesBySegmentId.value = new Map(item.segments.map((segment) => [segment.id, null]))
    }
  }
}

function segmentTravelTime(segment: RouteSegment) {
  const duration = travelMinutesBySegmentId.value.get(segment.id)
  return duration == null
    ? 'Время не рассчитано'
    : `≈ ${Math.max(1, Math.round(duration))} мин в пути`
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
  void refreshTravelTimes()
}

function directionFallback(item: Direction) {
  const first = stopById.value.get(item.stopIds[0] ?? '')?.name
  const last = stopById.value.get(item.stopIds.at(-1) ?? '')?.name
  return {
    terminal: last ?? '',
    name: first && last ? `${first} → ${last}` : last ? `к ${last}` : '',
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
    rebuildSegments(item)
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
              ? 'Редактируйте направление независимыми участками.'
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
            <span class="route-number" :style="{ borderColor: route.color }">{{
              route.number
            }}</span>
            <span class="route-list-copy">
              <strong>{{
                route.name || route.directions[0]?.name || `Маршрут № ${route.number}`
              }}</strong>
              <small>{{ route.directions.length }} направл.</small>
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
            <input v-model="edited.color" type="color" title="Цвет маршрута для пассажиров" />
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
          <label>
            Тип направления
            <select :value="direction.routeType" @change="handleRouteTypeChange">
              <option value="linear">Линейное — A и B не соединяются</option>
              <option value="circular">Кольцевое — добавить сегмент B → A</option>
            </select>
          </label>
          <label class="switch-control">
            <input v-model="direction.active" type="checkbox" />
            <span>Направление активно</span>
          </label>
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
          :segments="direction?.segments"
          :selected-segment-id="selectedSegmentId"
          :via-points="segmentViaPoints"
          :road-anchors="roadAnchors"
          :active-road-anchor="activeRoadAnchor"
          :manual-draft-coordinates="manualDraftCoordinates"
          :interaction-mode="mapMode"
          :selected-stop-id="selectedMapStopId"
          :selected-stop-ids="direction?.stopIds"
          :route-color="edited?.color"
          @stop-click="selectMapStop"
          @segment-click="selectSegment"
          @map-click="handleMapClick"
          @road-anchor-move="moveRoadAnchor"
        />
        <div v-if="edited" class="map-hint">
          <template v-if="mapMode === 'via'">
            Поставьте промежуточную точку в выбранном отрезке.
          </template>
          <template v-else-if="mapMode === 'manual'">
            Ставьте точки ручной линии по порядку.
          </template>
          <template v-else>Нажмите на линию, чтобы выбрать конкретный отрезок.</template>
        </div>

        <div v-if="edited && selectedMapStop" class="map-stop-actions" @click.stop>
          <button class="map-stop-close" title="Закрыть" @click="closeStopMenu">×</button>
          <strong>{{ selectedMapStop.name }}</strong>
          <template v-if="selectedMapStopIsInRoute">
            <span
              >Остановка {{ direction!.stopIds.indexOf(selectedMapStop.id) + 1 }} в
              направлении</span
            >
            <button class="secondary stop-action" @click="beginRoadAnchorEditing">
              {{
                selectedStopHasCustomAnchor ? 'Изменить дорожный якорь' : 'Добавить дорожный якорь'
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
            <button class="text-danger stop-action" @click="removeSelectedStop">
              Удалить из маршрута
            </button>
            <button
              v-if="selectedStopHasCustomAnchor"
              class="secondary stop-action"
              @click="resetRoadAnchor"
            >
              Сбросить дорожный якорь
            </button>
          </template>
          <template v-else>
            <span>
              {{
                selectedSegment
                  ? 'Остановка будет вставлена в выбранный сегмент'
                  : 'Без выбранного сегмента остановка добавится в конец'
              }}
            </span>
            <button class="stop-action" @click="addSelectedStop">Добавить в маршрут</button>
          </template>
        </div>
      </div>

      <aside
        v-if="edited && direction"
        class="panel route-order-panel segment-editor-panel combined-sequence-panel"
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
              <strong>Остановки и отрезки</strong>
            </div>
            <span>{{ direction.segments.length }}</span>
          </div>

          <button
            class="rebuild-all-route-button secondary"
            :disabled="rebuildingAll || routing || !direction.segments.length"
            @click="rebuildAllSegments"
          >
            {{ rebuildingAll ? rebuildProgress : 'Перестроить весь маршрут автоматически' }}
          </button>

          <ol v-if="routeSequence.length" class="waypoints route-waypoints combined-route-sequence">
            <template v-for="item in routeSequence" :key="item.key">
              <li
                v-if="item.type === 'stop'"
                draggable="true"
                @dragstart="dragStopIndex = item.index"
                @dragend="dragStopIndex = null"
                @dragover.prevent
                @drop="dropStop(item.index)"
              >
                <span class="drag-handle" title="Перетащить">⋮⋮</span>
                <span>{{
                  item.index === 0
                    ? 'A'
                    : item.index === direction.stopIds.length - 1
                      ? 'B'
                      : item.index + 1
                }}</span>
                <strong>{{ stopById.get(item.stopId)?.name ?? item.stopId }}</strong>
                <button title="Выше" @click.stop="moveStop(item.index, -1)">↑</button>
                <button title="Ниже" @click.stop="moveStop(item.index, 1)">↓</button>
                <button title="Удалить" @click.stop="removeStopById(item.stopId)">×</button>
              </li>
              <li
                v-else
                class="combined-segment-row"
                :class="{ active: item.segment.id === selectedSegmentId }"
                role="button"
                tabindex="0"
                @click.stop="selectSegment(item.segment.id)"
                @keydown.enter.prevent="selectSegment(item.segment.id)"
                @keydown.space.prevent="selectSegment(item.segment.id)"
              >
                <span>{{ item.index + 1 }}</span>
                <strong>{{ segmentName(item.segment) }}</strong>
                <small :class="`segment-${item.segment.status}`">
                  {{ segmentStatus(item.segment) }}
                </small>
                <small class="segment-travel-time">{{ segmentTravelTime(item.segment) }}</small>
              </li>
            </template>
          </ol>
          <div v-else class="empty-state">Добавьте остановки на карте в нужном порядке.</div>

          <div v-if="selectedSegment" class="segment-tools">
            <strong>{{ segmentName(selectedSegment) }}</strong>
            <span>{{ segmentStatus(selectedSegment) }}</span>
            <button
              class="secondary"
              :disabled="routing || selectedSegment.status === 'fixed'"
              @click="buildSelectedSegment"
            >
              {{ routing ? 'Прокладываем…' : 'Построить этот отрезок автоматически' }}
            </button>
            <button
              class="secondary"
              :disabled="selectedSegment.status === 'fixed'"
              @click="beginViaMode"
            >
              Добавить промежуточную точку
            </button>
            <button
              v-if="mapMode !== 'manual'"
              class="secondary"
              :disabled="selectedSegment.status === 'fixed'"
              @click="beginManualDrawing"
            >
              Нарисовать вручную
            </button>
            <div v-else class="manual-actions">
              <button @click="finishManualDrawing">Завершить линию</button>
              <button class="secondary" @click="cancelManualDrawing">Отмена</button>
            </div>
            <button
              :class="{ secondary: selectedSegment.status !== 'fixed' }"
              @click="toggleSegmentFixed"
            >
              {{
                selectedSegment.status === 'fixed'
                  ? 'Снять фиксацию'
                  : 'Проверить и зафиксировать'
              }}
            </button>
            <button
              class="text-danger"
              :disabled="selectedSegment.status === 'fixed'"
              @click="clearSelectedSegment"
            >
              Очистить отрезок
            </button>

            <div v-if="selectedSegment.viaPoints.length" class="segment-via-list">
              <strong>Промежуточные точки</strong>
              <div v-for="(_, index) in selectedSegment.viaPoints" :key="index">
                <span>Промежуточная точка {{ index + 1 }}</span>
                <button title="Удалить" @click="removeVia(index)">×</button>
              </div>
            </div>
          </div>

          <p v-if="message" class="notice" :class="{ error: messageType === 'error' }">
            {{ message }}
          </p>
          <div class="route-actions single-action">
            <button :disabled="saving" @click="save">
              {{ saving ? 'Сохраняем…' : 'Сохранить маршрут' }}
            </button>
          </div>
        </template>
      </aside>
    </div>
  </section>
</template>
