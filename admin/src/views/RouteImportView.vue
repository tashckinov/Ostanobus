<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { api } from '../api'
import TransitMap from '../components/TransitMap.vue'
import type { Direction, Route, RouteSegment, Stop } from '../types'

type JsonObject = Record<string, unknown>

type ImportedStop = Stop & {
  sourceId: string
  regionId: number | null
}

type ImportedDirection = Direction & {
  sourceThreadId: string
}

type ImportDraft = {
  sourceLineId: string
  number: string
  name: string
  color: string
  stops: ImportedStop[]
  directions: ImportedDirection[]
}

type ValidationIssue = {
  level: 'error' | 'warning'
  text: string
}

const existingStops = ref<Stop[]>([])
const existingRoutes = ref<Route[]>([])
const draft = ref<ImportDraft | null>(null)
const activeDirectionIndex = ref(0)
const selectedStopId = ref<string | null>(null)
const fileName = ref('')
const loading = ref(true)
const importing = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')

const activeDirection = computed(() => draft.value?.directions[activeDirectionIndex.value] ?? null)
const previewStops = computed(() => draft.value?.stops ?? [])
const stopById = computed(() => new Map(previewStops.value.map((stop) => [stop.id, stop])))
const selectedStop = computed(() =>
  selectedStopId.value ? (stopById.value.get(selectedStopId.value) ?? null) : null,
)

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null
}

function string(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function number(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function array(value: unknown) {
  return Array.isArray(value) ? value : []
}

function generatedId(kind: 'route' | 'direction' | 'segment') {
  return `${kind}-${crypto.randomUUID()}`
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

function coordinates(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null
  const longitude = number(value[0])
  const latitude = number(value[1])
  if (longitude === null || latitude === null) return null
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return null
  return [longitude, latitude]
}

function lineCoordinates(value: unknown): number[][] {
  return array(value)
    .map(coordinates)
    .filter((point): point is [number, number] => point !== null)
}

function colorFromSource(value: unknown) {
  const source = object(value)
  const onMap = string(source?.onMap)
  const match = onMap.match(/#[0-9a-f]{6}/i)
  return match?.[0] ?? '#0074dc'
}

function parseRawGetLine(payload: JsonObject): ImportDraft | null {
  const data = object(payload.data)
  const directionContainers = array(data?.features)
  if (!directionContainers.length) return null

  const importedStops = new Map<string, ImportedStop>()
  const directions: ImportedDirection[] = []
  let sourceLineId = ''
  let routeNumber = ''
  let routeType = 'bus'

  for (const containerValue of directionContainers) {
    const container = object(containerValue)
    const properties = object(container?.properties)
    const metadata = object(properties?.ThreadMetaData)
    const threadId = string(metadata?.id)
    const lineId = string(metadata?.lineId)
    const numberValue = string(metadata?.name)
    if (!threadId || !lineId || !numberValue) continue

    sourceLineId ||= lineId
    routeNumber ||= numberValue
    routeType = string(metadata?.type) || routeType

    const stopIds: string[] = []
    const segments: RouteSegment[] = []
    let previousStopId: string | null = null
    let pendingGeometry: number[][] = []

    for (const featureValue of array(container?.features)) {
      const feature = object(featureValue)
      if (!feature) continue

      const points = lineCoordinates(feature.points)
      if (points.length > 1) {
        pendingGeometry = points
        continue
      }

      const id = string(feature.id)
      const point = coordinates(feature.coordinates)
      const name = string(feature.name)
      if (!id || !point || !name) continue

      const region = object(feature.region)
      importedStops.set(id, {
        id,
        sourceId: id,
        cityId: 'volgodonsk',
        name,
        shortName: name,
        longitude: point[0],
        latitude: point[1],
        osmId: null,
        osmUrl: null,
        active: true,
        regionId: number(region?.id),
      })
      stopIds.push(id)

      if (previousStopId) {
        const geometry = pendingGeometry.length > 1
          ? { type: 'LineString' as const, coordinates: pendingGeometry }
          : null
        segments.push({
          id: generatedId('segment'),
          fromStopId: previousStopId,
          toStopId: id,
          mode: geometry ? 'manual' : 'automatic',
          status: geometry ? 'fixed' : 'error',
          viaPoints: [],
          geometry,
          distanceMeters: geometry ? lineDistance(pendingGeometry) : null,
        })
      }

      previousStopId = id
      pendingGeometry = []
    }

    const first = importedStops.get(stopIds[0] ?? '')?.name ?? ''
    const last = importedStops.get(stopIds.at(-1) ?? '')?.name ?? ''
    directions.push({
      id: generatedId('direction'),
      sourceThreadId: threadId,
      name: first && last ? `${first} → ${last}` : `Направление ${directions.length + 1}`,
      terminal: last,
      stopIds,
      roadAnchors: [],
      routeType: 'linear',
      segments,
      active: true,
    })
  }

  if (!sourceLineId || !routeNumber || !directions.length) return null

  return {
    sourceLineId,
    number: routeNumber,
    name: `Маршрут ${routeNumber}`,
    color: colorFromSource(data?.color),
    stops: [...importedStops.values()],
    directions,
  }
}

function parsePreparedExport(payload: JsonObject): ImportDraft | null {
  const preparedDirections = array(payload.lineDirections ?? payload.directions)
  if (!preparedDirections.length) return null

  const importedStops = new Map<string, ImportedStop>()
  const directions: ImportedDirection[] = []
  let sourceLineId = ''
  let routeNumber = ''

  for (const directionValue of preparedDirections) {
    const direction = object(directionValue)
    if (!direction) continue
    const lineId = string(direction.lineId)
    const threadId = string(direction.threadId ?? direction.id)
    const numberValue = string(direction.routeName ?? direction.name ?? direction.number)
    const sourceStops = array(direction.stops)
    if (!lineId || !threadId || !sourceStops.length) continue

    sourceLineId ||= lineId
    routeNumber ||= numberValue
    const stopIds: string[] = []

    for (const stopValue of sourceStops) {
      const stop = object(stopValue)
      const id = string(stop?.id ?? stop?.stopId)
      const point = coordinates(stop?.coordinates)
      const name = string(stop?.name)
      if (!id || !point || !name) continue
      importedStops.set(id, {
        id,
        sourceId: id,
        cityId: 'volgodonsk',
        name,
        shortName: name,
        longitude: point[0],
        latitude: point[1],
        osmId: null,
        osmUrl: null,
        active: true,
        regionId: number(stop?.regionId),
      })
      stopIds.push(id)
    }

    const sourceSegments = array(direction.segments)
    const segments = sourceSegments.map((segmentValue, index) => {
      const segment = object(segmentValue)
      const geometrySource = object(segment?.geometry)
      const geometryCoordinates = lineCoordinates(geometrySource?.coordinates ?? segment?.points)
      const fromStopId = string(segment?.fromStopId) || stopIds[index] || ''
      const toStopId = string(segment?.toStopId) || stopIds[index + 1] || ''
      const geometry = geometryCoordinates.length > 1
        ? { type: 'LineString' as const, coordinates: geometryCoordinates }
        : null
      return {
        id: generatedId('segment'),
        fromStopId,
        toStopId,
        mode: geometry ? ('manual' as const) : ('automatic' as const),
        status: geometry ? ('fixed' as const) : ('error' as const),
        viaPoints: [],
        geometry,
        distanceMeters: geometry ? lineDistance(geometryCoordinates) : null,
      }
    })

    const first = importedStops.get(stopIds[0] ?? '')?.name ?? ''
    const last = importedStops.get(stopIds.at(-1) ?? '')?.name ?? ''
    directions.push({
      id: generatedId('direction'),
      sourceThreadId: threadId,
      name: string(direction.name) || (first && last ? `${first} → ${last}` : ''),
      terminal: string(direction.terminal) || last,
      stopIds,
      roadAnchors: [],
      routeType: string(direction.routeType) === 'circular' ? 'circular' : 'linear',
      segments,
      active: true,
    })
  }

  if (!sourceLineId || !directions.length) return null
  return {
    sourceLineId,
    number: routeNumber || sourceLineId,
    name: string(payload.routeName) || `Маршрут ${routeNumber || sourceLineId}`,
    color: string(payload.color) || '#0074dc',
    stops: [...importedStops.values()],
    directions,
  }
}

function parsePayload(value: unknown) {
  const payload = object(value)
  if (!payload) throw new Error('В корне файла должен быть JSON-объект')
  return parseRawGetLine(payload) ?? parsePreparedExport(payload)
}

function endpointsClose(segment: RouteSegment) {
  if (!segment.geometry?.coordinates.length) return true
  const from = stopById.value.get(segment.fromStopId)
  const to = stopById.value.get(segment.toStopId)
  if (!from || !to) return false
  const first = segment.geometry.coordinates[0]!
  const last = segment.geometry.coordinates.at(-1)!
  const tolerance = 0.004
  return (
    Math.abs(first[0]! - from.longitude) < tolerance &&
    Math.abs(first[1]! - from.latitude) < tolerance &&
    Math.abs(last[0]! - to.longitude) < tolerance &&
    Math.abs(last[1]! - to.latitude) < tolerance
  )
}

const issues = computed<ValidationIssue[]>(() => {
  const result: ValidationIssue[] = []
  const item = draft.value
  if (!item) return result

  if (!item.number.trim()) result.push({ level: 'error', text: 'Не указан номер маршрута.' })
  if (!item.directions.length) result.push({ level: 'error', text: 'Нет ни одного направления.' })
  if (existingRoutes.value.some((route) => route.number.toLowerCase() === item.number.toLowerCase())) {
    result.push({ level: 'warning', text: `Маршрут № ${item.number} уже существует и будет перезаписан по номеру.` })
  }

  for (const [index, direction] of item.directions.entries()) {
    const label = `Направление ${index + 1}`
    if (direction.stopIds.length < 2) {
      result.push({ level: 'error', text: `${label}: должно быть минимум две остановки.` })
      continue
    }
    if (new Set(direction.stopIds).size !== direction.stopIds.length) {
      result.push({ level: 'warning', text: `${label}: обнаружены повторяющиеся stopId.` })
    }
    const expectedSegments = direction.routeType === 'circular'
      ? direction.stopIds.length
      : direction.stopIds.length - 1
    if (direction.segments.length !== expectedSegments) {
      result.push({ level: 'error', text: `${label}: ${direction.stopIds.length} остановок, но ${direction.segments.length} сегментов.` })
    }
    const missingGeometry = direction.segments.filter((segment) => !segment.geometry).length
    if (missingGeometry) {
      result.push({ level: 'warning', text: `${label}: у ${missingGeometry} сегментов нет геометрии.` })
    }
    const detached = direction.segments.filter((segment) => segment.geometry && !endpointsClose(segment)).length
    if (detached) {
      result.push({ level: 'warning', text: `${label}: у ${detached} сегментов геометрия не совпадает с координатами остановок.` })
    }
  }

  const foreignStops = item.stops.filter((stop) => stop.regionId !== null && stop.regionId !== 11036)
  if (foreignStops.length) {
    result.push({ level: 'warning', text: `${foreignStops.length} остановок относятся не к региону Волгодонска.` })
  }
  return result
})

const hasErrors = computed(() => issues.value.some((issue) => issue.level === 'error'))
const canImport = computed(() => Boolean(draft.value && !hasErrors.value && !importing.value))

function rebuildDirectionSegments(direction: ImportedDirection) {
  const existing = new Map(
    direction.segments.map((segment) => [`${segment.fromStopId}\u0000${segment.toStopId}`, segment]),
  )
  const pairs = direction.stopIds.slice(0, -1).map((stopId, index) => [stopId, direction.stopIds[index + 1]!] as const)
  if (direction.routeType === 'circular' && direction.stopIds.length > 1) {
    pairs.push([direction.stopIds.at(-1)!, direction.stopIds[0]!] as const)
  }
  direction.segments = pairs.map(([fromStopId, toStopId]) => {
    const direct = existing.get(`${fromStopId}\u0000${toStopId}`)
    if (direct) return direct
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
  })
}

function removeStop(stopId: string) {
  const item = draft.value
  if (!item) return
  for (const direction of item.directions) {
    const index = direction.stopIds.indexOf(stopId)
    if (index < 0) continue

    const previousStopId = direction.stopIds[index - 1]
    const nextStopId = direction.stopIds[index + 1]
    const previousSegment = previousStopId
      ? direction.segments.find((segment) => segment.fromStopId === previousStopId && segment.toStopId === stopId)
      : null
    const nextSegment = nextStopId
      ? direction.segments.find((segment) => segment.fromStopId === stopId && segment.toStopId === nextStopId)
      : null

    direction.stopIds.splice(index, 1)
    direction.segments = direction.segments.filter(
      (segment) => segment.fromStopId !== stopId && segment.toStopId !== stopId,
    )

    if (previousStopId && nextStopId) {
      const mergedCoordinates = [
        ...(previousSegment?.geometry?.coordinates ?? []),
        ...(nextSegment?.geometry?.coordinates ?? []).slice(1),
      ]
      direction.segments.push({
        id: generatedId('segment'),
        fromStopId: previousStopId,
        toStopId: nextStopId,
        mode: mergedCoordinates.length > 1 ? 'manual' : 'automatic',
        status: mergedCoordinates.length > 1 ? 'fixed' : 'error',
        viaPoints: [],
        geometry: mergedCoordinates.length > 1
          ? { type: 'LineString', coordinates: mergedCoordinates }
          : null,
        distanceMeters: mergedCoordinates.length > 1 ? lineDistance(mergedCoordinates) : null,
      })
    }
    rebuildDirectionSegments(direction)
  }

  if (!item.directions.some((direction) => direction.stopIds.includes(stopId))) {
    item.stops = item.stops.filter((stop) => stop.id !== stopId)
  }
  selectedStopId.value = null
}

function selectStop(stop: Stop) {
  selectedStopId.value = stop.id
}

async function readFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  try {
    const parsed = JSON.parse(await file.text()) as unknown
    const nextDraft = parsePayload(parsed)
    if (!nextDraft) {
      throw new Error('Формат не распознан. Нужен ответ getLine или экспорт с lineDirections/directions.')
    }
    draft.value = nextDraft
    activeDirectionIndex.value = 0
    selectedStopId.value = null
    fileName.value = file.name
    message.value = ''
  } catch (error) {
    draft.value = null
    messageType.value = 'error'
    message.value = error instanceof Error ? error.message : 'Не удалось прочитать файл'
  }
}

function distanceBetween(left: Stop, right: Stop) {
  const latitude = ((left.latitude + right.latitude) / 2) * (Math.PI / 180)
  const dx = (left.longitude - right.longitude) * Math.cos(latitude) * 111_320
  const dy = (left.latitude - right.latitude) * 110_540
  return Math.sqrt(dx * dx + dy * dy)
}

function findExistingStop(imported: ImportedStop) {
  return existingStops.value.find((stop) => stop.name === imported.name && distanceBetween(stop, imported) < 80)
}

async function importRoute() {
  const item = draft.value
  if (!item || hasErrors.value) return
  importing.value = true
  message.value = ''

  try {
    const idMap = new Map<string, string>()
    for (const imported of item.stops) {
      const existing = findExistingStop(imported)
      if (existing) {
        idMap.set(imported.id, existing.id)
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

    const existingRoute = existingRoutes.value.find(
      (route) => route.number.toLowerCase() === item.number.toLowerCase(),
    )
    const route: Route = {
      routeId: existingRoute?.routeId ?? generatedId('route'),
      cityId: 'volgodonsk',
      number: item.number.trim(),
      name: item.name.trim() || null,
      color: item.color,
      active: true,
      isMock: false,
      directions: item.directions.map((direction) => ({
        id: existingRoute?.directions.find((saved) => saved.name === direction.name)?.id ?? generatedId('direction'),
        name: direction.name,
        terminal: direction.terminal,
        stopIds: direction.stopIds.map((stopId) => idMap.get(stopId) ?? stopId),
        roadAnchors: direction.roadAnchors.map((anchor) => ({
          ...anchor,
          stopId: idMap.get(anchor.stopId) ?? anchor.stopId,
        })),
        routeType: direction.routeType,
        segments: direction.segments.map((segment) => ({
          ...segment,
          id: generatedId('segment'),
          fromStopId: idMap.get(segment.fromStopId) ?? segment.fromStopId,
          toStopId: idMap.get(segment.toStopId) ?? segment.toStopId,
        })),
        active: direction.active,
      })),
    }

    await api.saveRoute(route)
    await loadReferenceData()
    messageType.value = 'success'
    message.value = `Маршрут № ${route.number} загружен: ${route.directions.length} направления, ${item.stops.length} остановок.`
  } catch (error) {
    messageType.value = 'error'
    message.value = error instanceof Error ? error.message : 'Не удалось импортировать маршрут'
  } finally {
    importing.value = false
  }
}

async function loadReferenceData() {
  ;[existingStops.value, existingRoutes.value] = await Promise.all([api.stops(), api.routes()])
}

onMounted(async () => {
  try {
    await loadReferenceData()
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <section class="editor-page route-import-page">
    <header class="page-header">
      <div>
        <h1>Импорт маршрута</h1>
        <p>Загрузите ответ getLine, проверьте оба направления, остановки и геометрию, затем подтвердите запись.</p>
      </div>
      <label class="route-import-file">
        <input type="file" accept="application/json,.json" @change="readFile" />
        Выбрать JSON
      </label>
    </header>

    <p v-if="loading" class="empty-state">Загрузка справочников…</p>
    <div v-else-if="!draft" class="route-import-empty panel">
      <strong>Файл ещё не выбран</strong>
      <span>Поддерживается сырой ответ <code>getLine</code> и подготовленный экспорт с направлениями, остановками и сегментами.</span>
      <p v-if="message" class="route-import-message error">{{ message }}</p>
    </div>

    <template v-else>
      <div class="route-import-summary panel">
        <div>
          <span>Файл</span>
          <strong>{{ fileName }}</strong>
        </div>
        <label>Номер<input v-model="draft.number" /></label>
        <label>Название<input v-model="draft.name" /></label>
        <label class="route-import-color">Цвет<input v-model="draft.color" type="color" /></label>
        <div>
          <span>Источник</span>
          <strong>lineId {{ draft.sourceLineId }}</strong>
        </div>
      </div>

      <div class="route-import-validation panel">
        <div class="route-import-validation-heading">
          <div>
            <span>Проверка</span>
            <strong>{{ hasErrors ? 'Есть ошибки' : issues.length ? 'Нужна проверка' : 'Маршрут корректен' }}</strong>
          </div>
          <span>{{ issues.length }}</span>
        </div>
        <p v-if="!issues.length" class="route-import-ok">Ошибок и предупреждений не найдено.</p>
        <ul v-else>
          <li v-for="issue in issues" :key="issue.text" :class="issue.level">{{ issue.text }}</li>
        </ul>
      </div>

      <div class="route-import-workspace">
        <aside class="panel route-import-directions">
          <strong>Направления</strong>
          <button
            v-for="(direction, index) in draft.directions"
            :key="direction.id"
            :class="{ active: activeDirectionIndex === index }"
            @click="activeDirectionIndex = index; selectedStopId = null"
          >
            <span>{{ index + 1 }}</span>
            <div>
              <strong>{{ direction.name }}</strong>
              <small>{{ direction.stopIds.length }} остановок · {{ direction.segments.length }} сегментов</small>
            </div>
          </button>
        </aside>

        <div class="route-import-map">
          <TransitMap
            :stops="previewStops"
            :segments="activeDirection?.segments"
            :selected-stop-id="selectedStopId"
            :selected-stop-ids="activeDirection?.stopIds"
            :route-color="draft.color"
            @stop-click="selectStop"
          />
        </div>

        <aside class="panel route-import-stops">
          <div class="route-import-stops-heading">
            <div>
              <span>Порядок</span>
              <strong>{{ activeDirection?.name }}</strong>
            </div>
            <span>{{ activeDirection?.stopIds.length }}</span>
          </div>
          <ol>
            <li
              v-for="(stopId, index) in activeDirection?.stopIds"
              :key="stopId"
              :class="{ selected: selectedStopId === stopId }"
              @click="selectedStopId = stopId"
            >
              <span>{{ index + 1 }}</span>
              <div>
                <strong>{{ stopById.get(stopId)?.name ?? stopId }}</strong>
                <small>{{ stopId }}</small>
              </div>
              <button title="Удалить остановку из всех направлений" @click.stop="removeStop(stopId)">×</button>
            </li>
          </ol>
          <div v-if="selectedStop" class="route-import-selected-stop">
            <strong>{{ selectedStop.name }}</strong>
            <span>{{ selectedStop.longitude.toFixed(6) }}, {{ selectedStop.latitude.toFixed(6) }}</span>
            <button class="danger" @click="removeStop(selectedStop.id)">Удалить лишнюю остановку</button>
          </div>
        </aside>
      </div>

      <div class="route-import-footer panel">
        <p v-if="message" class="route-import-message" :class="messageType">{{ message }}</p>
        <div>
          <button class="secondary" @click="draft = null; selectedStopId = null; message = ''">Сбросить</button>
          <button :disabled="!canImport" @click="importRoute">
            {{ importing ? 'Загрузка…' : 'Маршрут проверен — загрузить' }}
          </button>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.route-import-page { min-height: 100%; }
.route-import-file { display: inline-flex; align-items: center; justify-content: center; min-height: 42px; padding: 0 18px; background: #111827; color: #fff; cursor: pointer; font-weight: 700; }
.route-import-file input { display: none; }
.route-import-empty { min-height: 220px; display: grid; place-content: center; gap: 10px; text-align: center; }
.route-import-empty span { max-width: 650px; color: #64748b; }
.route-import-summary { display: grid; grid-template-columns: 1fr 120px minmax(240px, 1fr) 90px 170px; gap: 14px; align-items: end; margin-bottom: 14px; }
.route-import-summary > div, .route-import-summary label { display: grid; gap: 6px; }
.route-import-summary span, .route-import-summary label { font-size: 12px; color: #64748b; }
.route-import-summary strong { color: #111827; font-size: 14px; }
.route-import-summary input { min-width: 0; }
.route-import-color input { width: 100%; height: 42px; padding: 3px; }
.route-import-validation { margin-bottom: 14px; }
.route-import-validation-heading, .route-import-stops-heading { display: flex; justify-content: space-between; align-items: center; }
.route-import-validation-heading div, .route-import-stops-heading div { display: grid; gap: 3px; }
.route-import-validation-heading span, .route-import-stops-heading span { color: #64748b; font-size: 12px; }
.route-import-validation ul { margin: 12px 0 0; padding-left: 20px; }
.route-import-validation li { margin: 5px 0; }
.route-import-validation li.error { color: #b91c1c; }
.route-import-validation li.warning { color: #9a6700; }
.route-import-ok { color: #166534; margin-bottom: 0; }
.route-import-workspace { display: grid; grid-template-columns: 270px minmax(420px, 1fr) 330px; gap: 14px; min-height: 650px; }
.route-import-directions, .route-import-stops { min-height: 0; overflow: auto; }
.route-import-directions > button { width: 100%; display: flex; gap: 10px; align-items: center; text-align: left; background: transparent; color: #111827; border: 1px solid #e2e8f0; margin-top: 8px; padding: 10px; }
.route-import-directions > button.active { border-color: #111827; background: #f8fafc; }
.route-import-directions > button > span { min-width: 28px; height: 28px; display: grid; place-items: center; background: #e2e8f0; }
.route-import-directions button div { display: grid; gap: 3px; }
.route-import-directions small, .route-import-stops small { color: #64748b; }
.route-import-map { min-height: 650px; overflow: hidden; border: 1px solid #dbe2ea; background: #eef2f6; }
.route-import-map :deep(.map) { min-height: 650px; height: 100%; }
.route-import-stops ol { list-style: none; padding: 0; margin: 12px 0; display: grid; gap: 6px; }
.route-import-stops li { display: grid; grid-template-columns: 28px 1fr 30px; gap: 8px; align-items: center; padding: 8px; border: 1px solid #e2e8f0; cursor: pointer; }
.route-import-stops li.selected { border-color: #111827; background: #f8fafc; }
.route-import-stops li > span { color: #64748b; font-size: 12px; }
.route-import-stops li div { display: grid; gap: 2px; min-width: 0; }
.route-import-stops li button { min-height: 28px; padding: 0; background: transparent; color: #b91c1c; font-size: 20px; }
.route-import-selected-stop { display: grid; gap: 8px; padding-top: 12px; border-top: 1px solid #e2e8f0; }
.route-import-selected-stop span { color: #64748b; font-size: 12px; }
.route-import-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 14px; }
.route-import-footer > div { display: flex; gap: 10px; margin-left: auto; }
.route-import-message { margin: 0; }
.route-import-message.success { color: #166534; }
.route-import-message.error { color: #b91c1c; }
@media (max-width: 1200px) {
  .route-import-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .route-import-workspace { grid-template-columns: 240px minmax(420px, 1fr); }
  .route-import-stops { grid-column: 1 / -1; max-height: 420px; }
}
</style>
