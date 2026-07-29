<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { api } from '../api'
import TransitMap from '../components/TransitMap.vue'
import type { Direction, Route, RouteSegment, Stop } from '../types'

type ExportRoute = { lineId: string; name: string; type: string }
type ExportStop = { id: string; name: string; coordinates: [number, number] }
type ExportSchedule = {
  lineId: string
  threadId: string
  stopId: string
  originStopId?: string
  destinationStopId?: string
  destinationName?: string
  scheduledTimes?: string[]
  frequencies?: Array<{ begin: string; end: string; intervalSeconds: number }>
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
  uniqueStops: number
  threadCount: number
}
type DraftStop = Stop & { sourceId: string }
type DraftDirection = Direction & { sourceThreadId: string }
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

const direction = computed(() => draft.value?.directions[selectedDirectionIndex.value] ?? null)
const stopById = computed(() => new Map((draft.value?.stops ?? []).map((stop) => [stop.id, stop])))
const selectedStop = computed(() => selectedStopId.value ? stopById.value.get(selectedStopId.value) ?? null : null)
const hasImportErrors = computed(() => !draft.value || draft.value.directions.some((item) => item.stopIds.length < 2))
const warnings = computed(() => {
  const result: string[] = []
  if (!draft.value) return result
  if (draft.value.directions.length < 2) result.push('В файле найдено только одно направление маршрута.')
  for (const [index, item] of draft.value.directions.entries()) {
    if (item.segments.some((segment) => !segment.geometry)) {
      result.push(`Направление ${index + 1}: исходной геометрии нет, участки будут построены автоматически при загрузке.`)
    }
  }
  const saved = existingRoutes.value.find((route) => route.number.toLowerCase() === draft.value!.number.toLowerCase())
  if (saved) result.push(`Маршрут № ${draft.value.number} уже существует и будет обновлён.`)
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

function schedulePosition(schedule: ExportSchedule) {
  const exact = schedule.scheduledTimes?.map(parseMinutes).find((value): value is number => value !== null)
  if (exact !== undefined) return exact
  return parseMinutes(schedule.frequencies?.[0]?.begin) ?? Number.MAX_SAFE_INTEGER
}

function straightSegment(from: DraftStop, to: DraftStop): RouteSegment {
  return {
    id: generatedId('segment'),
    fromStopId: from.id,
    toStopId: to.id,
    mode: 'automatic',
    status: 'error',
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

function buildCandidates(source: ExportPayload) {
  const routes = Array.isArray(source.routes) ? source.routes : []
  const schedules = Array.isArray(source.schedules) ? source.schedules : []
  return routes
    .map((route) => {
      const routeSchedules = schedules.filter((item) => item.lineId === route.lineId)
      return {
        route,
        schedules: routeSchedules,
        uniqueStops: new Set(routeSchedules.map((item) => item.stopId)).size,
        threadCount: new Set(routeSchedules.map((item) => item.threadId)).size,
      }
    })
    .filter((item) => item.schedules.length > 0)
    .sort((left, right) =>
      right.threadCount - left.threadCount || right.uniqueStops - left.uniqueStops || left.route.name.localeCompare(right.route.name, 'ru'),
    )
}

function buildDraft(lineId: string) {
  const source = payload.value
  if (!source) return
  const candidate = candidates.value.find((item) => item.route.lineId === lineId)
  if (!candidate) return

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
    const ordered = [...schedules]
      .filter((item) => draftStops.has(item.stopId))
      .sort((left, right) => schedulePosition(left) - schedulePosition(right))
    const stopIds = [...new Set(ordered.map((item) => item.stopId))]
    if (!stopIds.length) continue

    const first = draftStops.get(stopIds[0]!)
    const last = draftStops.get(stopIds.at(-1)!)
    const destination = ordered.find((item) => item.destinationName)?.destinationName || last?.name || ''
    const segments: RouteSegment[] = []
    for (let index = 0; index < stopIds.length - 1; index += 1) {
      const from = draftStops.get(stopIds[index]!)
      const to = draftStops.get(stopIds[index + 1]!)
      if (from && to) segments.push(straightSegment(from, to))
    }

    directions.push({
      id: generatedId('direction'),
      sourceThreadId: threadId,
      name: first && destination ? `${first.name} → ${destination}` : `Направление ${directions.length + 1}`,
      terminal: destination,
      stopIds,
      roadAnchors: [],
      routeType: 'linear',
      segments,
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
  if (!item) return
  for (const routeDirection of item.directions) {
    routeDirection.stopIds = routeDirection.stopIds.filter((id) => id !== stopId)
    routeDirection.segments = []
    for (let index = 0; index < routeDirection.stopIds.length - 1; index += 1) {
      const from = stopById.value.get(routeDirection.stopIds[index]!)
      const to = stopById.value.get(routeDirection.stopIds[index + 1]!)
      if (from && to) routeDirection.segments.push(straightSegment(from, to))
    }
  }
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

function existingStop(imported: DraftStop) {
  return existingStops.value.find((stop) => stop.name === imported.name && distanceBetween(stop, imported) < 80)
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

    const oldRoute = existingRoutes.value.find((route) => route.number.toLowerCase() === item.number.toLowerCase())
    const directions: Direction[] = []
    for (const sourceDirection of item.directions) {
      const mappedStopIds = sourceDirection.stopIds.map((id) => idMap.get(id) ?? id)
      const segments: RouteSegment[] = []
      for (let index = 0; index < sourceDirection.stopIds.length - 1; index += 1) {
        const fromSource = stopById.value.get(sourceDirection.stopIds[index]!)
        const toSource = stopById.value.get(sourceDirection.stopIds[index + 1]!)
        if (!fromSource || !toSource) continue
        let geometry: GeoJSON.LineString | null = null
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
          status: geometry ? 'draft' : 'error',
          viaPoints: [],
          geometry,
          distanceMeters,
        })
      }
      directions.push({
        id: oldRoute?.directions.find((saved) => saved.terminal === sourceDirection.terminal)?.id ?? generatedId('direction'),
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
    ;[existingStops.value, existingRoutes.value] = await Promise.all([api.stops(), api.routes()])
    messageType.value = 'success'
    message.value = `Маршрут № ${item.number} загружен. Проверьте и при необходимости поправьте его в разделе «Маршруты».`
  } catch (error) {
    messageType.value = 'error'
    message.value = error instanceof Error ? error.message : 'Не удалось загрузить маршрут'
  } finally {
    importing.value = false
  }
}

onMounted(async () => {
  ;[existingStops.value, existingRoutes.value] = await Promise.all([api.stops(), api.routes()])
})
</script>

<template>
  <section class="editor-page import-page">
    <header class="page-header">
      <div>
        <h1>Импорт маршрута</h1>
        <p>Загрузите обычный ostanobus_export, выберите маршрут и проверьте доступные остановки перед записью.</p>
      </div>
      <label class="file-button"><input type="file" accept="application/json,.json" @change="readFile" />Выбрать JSON</label>
    </header>

    <div v-if="!draft" class="panel empty-import">
      <strong>Выберите файл экспорта</strong>
      <span>Поддерживается текущий формат с полями routes, stops, schedules и vehicles.</span>
      <p v-if="message" class="error-text">{{ message }}</p>
    </div>

    <template v-else>
      <div class="panel import-controls">
        <div><span>Файл</span><strong>{{ fileName }}</strong></div>
        <label>Маршрут<select v-model="selectedLineId" @change="changeRoute"><option v-for="candidate in candidates" :key="candidate.route.lineId" :value="candidate.route.lineId">{{ candidate.route.name }} · {{ candidate.uniqueStops }} ост. · {{ candidate.threadCount }} напр.</option></select></label>
        <label>Номер<input v-model="draft.number" /></label>
        <label>Название<input v-model="draft.name" /></label>
      </div>

      <div class="panel validation">
        <strong>{{ hasImportErrors ? 'Есть ошибки' : warnings.length ? 'Нужна проверка' : 'Готово к загрузке' }}</strong>
        <ul v-if="warnings.length"><li v-for="warning in warnings" :key="warning">{{ warning }}</li></ul>
        <p v-if="hasImportErrors" class="error-text">В каждом направлении должно остаться минимум две остановки.</p>
      </div>

      <div class="import-grid">
        <aside class="panel directions">
          <strong>Направления</strong>
          <button v-for="(item, index) in draft.directions" :key="item.id" :class="{ active: selectedDirectionIndex === index }" @click="selectedDirectionIndex = index; selectedStopId = null">
            <span>{{ index + 1 }}</span><div><strong>{{ item.name }}</strong><small>{{ item.stopIds.length }} остановок</small></div>
          </button>
        </aside>

        <div class="map-wrap">
          <TransitMap :stops="draft.stops" :segments="direction?.segments" :selected-stop-id="selectedStopId" :selected-stop-ids="direction?.stopIds" route-color="#0074dc" @stop-click="(stop) => selectedStopId = stop.id" />
        </div>

        <aside class="panel stop-list">
          <div class="stop-list-heading"><strong>{{ direction?.name }}</strong><span>{{ direction?.stopIds.length }}</span></div>
          <ol>
            <li v-for="(stopId, index) in direction?.stopIds" :key="stopId" :class="{ selected: selectedStopId === stopId }" @click="selectedStopId = stopId">
              <span>{{ index + 1 }}</span><div><strong>{{ stopById.get(stopId)?.name ?? stopId }}</strong><small>{{ stopId }}</small></div><button title="Удалить" @click.stop="removeStop(stopId)">×</button>
            </li>
          </ol>
          <div v-if="selectedStop" class="selected-stop"><strong>{{ selectedStop.name }}</strong><span>{{ selectedStop.longitude.toFixed(6) }}, {{ selectedStop.latitude.toFixed(6) }}</span><button class="danger" @click="removeStop(selectedStop.id)">Удалить лишнюю остановку</button></div>
        </aside>
      </div>

      <div class="panel import-footer">
        <p v-if="message" :class="messageType">{{ message }}</p>
        <button :disabled="hasImportErrors || importing" @click="importRoute">{{ importing ? 'Загрузка…' : 'Маршрут проверен — загрузить' }}</button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.file-button{display:inline-flex;align-items:center;min-height:42px;padding:0 18px;background:#111827;color:#fff;font-weight:700;cursor:pointer}.file-button input{display:none}.empty-import{min-height:220px;display:grid;place-content:center;gap:10px;text-align:center}.empty-import span,.import-controls span,small{color:#64748b}.import-controls{display:grid;grid-template-columns:1fr minmax(260px,1fr) 110px minmax(220px,1fr);gap:14px;align-items:end;margin-bottom:14px}.import-controls>div,.import-controls label{display:grid;gap:6px}.validation{margin-bottom:14px}.validation ul{margin:10px 0 0;padding-left:20px;color:#9a6700}.error-text,.error{color:#b91c1c}.success{color:#166534}.import-grid{display:grid;grid-template-columns:270px minmax(420px,1fr) 330px;gap:14px;min-height:650px}.directions,.stop-list{overflow:auto}.directions>button{width:100%;display:flex;gap:10px;align-items:center;text-align:left;background:transparent;color:#111827;border:1px solid #e2e8f0;margin-top:8px;padding:10px}.directions>button.active{border-color:#111827;background:#f8fafc}.directions button div{display:grid;gap:3px}.map-wrap{min-height:650px;border:1px solid #dbe2ea;overflow:hidden}.map-wrap :deep(.map){height:100%;min-height:650px}.stop-list-heading{display:flex;justify-content:space-between}.stop-list ol{list-style:none;padding:0;margin:12px 0;display:grid;gap:6px}.stop-list li{display:grid;grid-template-columns:28px 1fr 30px;gap:8px;align-items:center;padding:8px;border:1px solid #e2e8f0;cursor:pointer}.stop-list li.selected{border-color:#111827;background:#f8fafc}.stop-list li div{display:grid;gap:2px;min-width:0}.stop-list li button{min-height:28px;padding:0;background:transparent;color:#b91c1c;font-size:20px}.selected-stop{display:grid;gap:8px;padding-top:12px;border-top:1px solid #e2e8f0}.selected-stop span{color:#64748b;font-size:12px}.import-footer{display:flex;justify-content:space-between;align-items:center;margin-top:14px}.import-footer button{margin-left:auto}@media(max-width:1200px){.import-controls{grid-template-columns:1fr 1fr}.import-grid{grid-template-columns:240px minmax(420px,1fr)}.stop-list{grid-column:1/-1;max-height:420px}}
</style>
