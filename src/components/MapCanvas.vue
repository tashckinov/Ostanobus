<script setup lang="ts">
import type { Feature, Point } from 'geojson'
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { buildRouteLines, decodePolyline } from '@/lib/route-geometry'
import { useTransitStore } from '@/stores/transit'
import type { RouteDirection } from '@/types/transit'

const transit = useTransitStore()
const mapContainer = ref<HTMLElement | null>(null)
let map: MapLibreMap | null = null

interface BusAnimation {
  marker: maplibregl.Marker
  el: HTMLElement
}
const busAnimations = new Map<string, BusAnimation>()
let globalAnimationFrame: number | null = null

interface ActiveTrip {
  id: string
  times: number[]
}

interface ActiveDirection {
  directionId: string
  routeColor: string
  routeNumber: string
  coords: number[][]
  segLengths: number[]
  stopRatios: number[]
  trips: ActiveTrip[]
}
const activeDirections: ActiveDirection[] = []

const mapStyle: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: 'osm',
      type: 'raster',
      source: 'osm',
      paint: {
        'raster-saturation': -0.55,
        'raster-contrast': -0.05,
        'raster-brightness-max': 0.94,
      },
    },
  ],
}

onMounted(() => {
  if (!mapContainer.value) return

  map = new maplibregl.Map({
    container: mapContainer.value,
    style: mapStyle,
    center: [42.216, 47.531],
    zoom: 13.8,
    minZoom: 11,
    maxZoom: 18,
    attributionControl: false,
  })

  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'top-right')

  map.on('load', () => {
    if (!map) return
    const routeStopIds = transit.routeStops.routes.flatMap((route) =>
      route.directions.flatMap((direction) => direction.stopIds),
    )

    map.addSource('route-lines', {
      type: 'geojson',
      data: buildRouteLines(transit.routeStops.routes, transit.stopsById),
    })
    map.addLayer({
      id: 'route-line-outline',
      type: 'line',
      source: 'route-lines',
      // скрыт по умолчанию — показывается только для выбранного маршрута
      filter: ['==', ['get', 'directionId'], ''],
      paint: {
        'line-color': '#ffffff',
        'line-width': 7,
        'line-opacity': 0.85,
      },
    })
    map.addLayer({
      id: 'route-lines',
      type: 'line',
      source: 'route-lines',
      // скрыт по умолчанию
      filter: ['==', ['get', 'directionId'], ''],
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 4,
        'line-opacity': 0.9,
      },
    })

    map.addSource('stops', {
      type: 'geojson',
      data: transit.stops,
    })
    map.addLayer({
      id: 'stop-halo',
      type: 'circle',
      source: 'stops',
      paint: {
        'circle-radius': 10,
        'circle-color': '#ffffff',
        'circle-opacity': 0.96,
        'circle-stroke-color': '#d5d9de',
        'circle-stroke-width': 1,
      },
    })
    map.addLayer({
      id: 'stops',
      type: 'circle',
      source: 'stops',
      paint: {
        'circle-radius': 5,
        'circle-color': '#1f2933',
      },
    })
    map.addLayer({
      id: 'route-stops',
      type: 'circle',
      source: 'stops',
      filter: ['in', ['get', 'id'], ['literal', routeStopIds]],
      paint: {
        'circle-radius': 6,
        'circle-color': '#0074dc',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    })
    map.addLayer({
      id: 'selected-stop',
      type: 'circle',
      source: 'stops',
      filter: ['==', ['get', 'id'], ''],
      paint: {
        'circle-radius': 15,
        'circle-color': '#0074dc',
        'circle-opacity': 0.2,
        'circle-stroke-color': '#0074dc',
        'circle-stroke-width': 2,
      },
    })

    map.on('click', 'stop-halo', (event) => {
      const stopId = event.features?.[0]?.properties?.id as string | undefined
      if (stopId) transit.selectStop(stopId)
    })
    map.on('mouseenter', 'stop-halo', () => {
      if (map) map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', 'stop-halo', () => {
      if (map) map.getCanvas().style.cursor = ''
    })

    initBusAnimations()
  })
})

// ─── Реакция на выбранную остановку ──────────────────────────────────────────

watch(
  () => transit.selectedStopId,
  (stopId) => {
    if (!map?.getLayer('selected-stop')) return
    map.setFilter('selected-stop', ['==', ['get', 'id'], stopId ?? ''])

    const stop = stopId ? transit.stopsById.get(stopId) : null
    if (stop) {
      const [longitude, latitude] = stop.geometry.coordinates
      map.easeTo({
        center: [longitude, latitude],
        zoom: Math.max(map.getZoom(), 14.2),
        duration: 500,
        padding: { top: 80, right: 30, bottom: 280, left: 30 },
      })
    }
  },
)

// ─── Реакция на выбранный маршрут ────────────────────────────────────────────

watch(
  () => transit.selectedRouteKey,
  (key) => {
    if (!map?.getLayer('route-lines')) return

    if (!key) {
      // Скрыть линии маршрутов
      map.setFilter('route-line-outline', ['==', ['get', 'directionId'], ''])
      map.setFilter('route-lines', ['==', ['get', 'directionId'], ''])
      for (const anim of busAnimations.values()) {
        anim.el.style.display = ''
      }
      return
    }

    const [, directionId] = key.split('::')
    map.setFilter('route-line-outline', ['==', ['get', 'directionId'], directionId ?? ''])
    map.setFilter('route-lines', ['==', ['get', 'directionId'], directionId ?? ''])

    // Оставить только бейдж выбранного направления
    for (const [tripId, anim] of busAnimations) {
      const display = tripId.startsWith(`${directionId}-trip`) ? '' : 'none'
      anim.el.style.display = display
    }
  },
)

// ─── Анимированный badge ──────────────────────────────────────────────────────

function getRouteCoordinates(direction: RouteDirection): number[][] {
  if (direction.geometry) return direction.geometry.coordinates
  if (direction.path) return decodePolyline(direction.path.value, direction.path.precision)
  return direction.stopIds
    .map((id) => transit.stopsById.get(id)?.geometry.coordinates)
    .filter((c): c is number[] => Boolean(c))
}

/** Суммарные длины сегментов (евклид в градусах — достаточно для анимации) */
function buildSegmentLengths(coords: number[][]): number[] {
  const lengths: number[] = []
  for (let i = 0; i < coords.length - 1; i++) {
    const dx = (coords[i + 1]![0]! - coords[i]![0]!)
    const dy = (coords[i + 1]![1]! - coords[i]![1]!)
    lengths.push(Math.sqrt(dx * dx + dy * dy))
  }
  return lengths
}

/** Возвращает [lng, lat] в точке t ∈ [0, 1] вдоль полилинии */
function interpolateAlong(coords: number[][], lengths: number[], t: number): [number, number] {
  const total = lengths.reduce((a, b) => a + b, 0)
  let target = t * total
  for (let i = 0; i < lengths.length; i++) {
    const len = lengths[i]!
    if (target <= len || i === lengths.length - 1) {
      const ratio = len > 0 ? Math.min(target / len, 1) : 0
      const a = coords[i]!
      const b = coords[i + 1]!
      return [a[0]! + (b[0]! - a[0]!) * ratio, a[1]! + (b[1]! - a[1]!) * ratio]
    }
    target -= len
  }
  const last = coords[coords.length - 1]!
  return [last[0]!, last[1]!]
}

function parseTime(value: string | null) {
  if (!value) return null
  const [hours, minutes] = value.split(':').map(Number)
  if (hours === undefined || minutes === undefined) return null
  return hours * 60 + minutes
}

function getCurrentDayAndMinutes() {
  const d = new Date()
  const moscowMs = d.getTime() + 3 * 60 * 60 * 1000
  const moscowDate = new Date(moscowMs)

  const jsWeekday = moscowDate.getUTCDay()
  const weekday = jsWeekday === 0 ? 7 : jsWeekday

  return {
    weekday,
    minutes:
      moscowDate.getUTCHours() * 60 +
      moscowDate.getUTCMinutes() +
      moscowDate.getUTCSeconds() / 60 +
      moscowDate.getUTCMilliseconds() / 60000,
  }
}

function mapStopsToPath(coords: number[][], stopCoords: number[][]): number[] {
  const lengths = [0]
  for (let i = 0; i < coords.length - 1; i++) {
    const dx = coords[i + 1]![0]! - coords[i]![0]!
    const dy = coords[i + 1]![1]! - coords[i]![1]!
    lengths.push(lengths[i]! + Math.sqrt(dx * dx + dy * dy))
  }
  const totalLength = lengths[lengths.length - 1]!
  if (totalLength === 0) return stopCoords.map(() => 0)

  const mapped = []
  let searchStartIndex = 0

  for (const stop of stopCoords) {
    let minDist = Infinity
    let bestRatio = 0
    let bestSegmentIndex = searchStartIndex

    for (let i = searchStartIndex; i < coords.length - 1; i++) {
      const a = coords[i]!
      const b = coords[i + 1]!
      const dx = b[0]! - a[0]!
      const dy = b[1]! - a[1]!
      const lenSq = dx * dx + dy * dy

      let t = 0
      if (lenSq !== 0) {
        t = ((stop[0]! - a[0]!) * dx + (stop[1]! - a[1]!) * dy) / lenSq
        t = Math.max(0, Math.min(1, t))
      }

      const projX = a[0]! + t * dx
      const projY = a[1]! + t * dy
      const distSq = (stop[0]! - projX) ** 2 + (stop[1]! - projY) ** 2

      if (distSq < minDist) {
        minDist = distSq
        bestSegmentIndex = i
        bestRatio = (lengths[i]! + t * Math.sqrt(lenSq)) / totalLength
      }
    }
    searchStartIndex = bestSegmentIndex
    mapped.push(bestRatio)
  }
  return mapped
}

function interpolateMissingTimes(tripStopTimes: (number | null)[], stopRatios: number[]) {
  for (let i = 0; i < tripStopTimes.length; i++) {
    if (tripStopTimes[i] === null) {
      let prevIdx = i - 1
      while (prevIdx >= 0 && tripStopTimes[prevIdx] === null) prevIdx--
      let nextIdx = i + 1
      while (nextIdx < tripStopTimes.length && tripStopTimes[nextIdx] === null) nextIdx++

      if (prevIdx >= 0 && nextIdx < tripStopTimes.length) {
        const prevTime = tripStopTimes[prevIdx]!
        let nextTime = tripStopTimes[nextIdx]!
        
        if (nextTime < prevTime && prevTime - nextTime > 720) {
          nextTime += 1440
        }

        const prevDist = stopRatios[prevIdx]!
        const nextDist = stopRatios[nextIdx]!
        const currDist = stopRatios[i]!
        const fraction =
          nextDist - prevDist === 0 ? 0 : (currDist - prevDist) / (nextDist - prevDist)
        tripStopTimes[i] = prevTime + fraction * (nextTime - prevTime)
      } else if (prevIdx >= 0) {
        tripStopTimes[i] = tripStopTimes[prevIdx]! + 1
      } else if (nextIdx < tripStopTimes.length) {
        tripStopTimes[i] = tripStopTimes[nextIdx]! - 1
      } else {
        tripStopTimes[i] = 0
      }
    }
  }
}

function buildTrips(direction: RouteDirection, weekday: number, stopRatios: number[]): ActiveTrip[] {
  const baseTrips: number[][] = []
  if (!direction.schedules || !direction.schedules.length) return []

  const daily = direction.schedules.filter((s) => s.days.includes(weekday))
  if (!daily.length) return []

  const intervalSchedules = daily.filter((s) => s.type === 'interval')
  if (intervalSchedules.length > 0) {
    let baseSch = intervalSchedules.find(
      (s) => s.stopId && s.startTime && s.endTime && s.headwayMinutes,
    )
    if (!baseSch) baseSch = intervalSchedules[0]
    
    if (baseSch && baseSch.headwayMinutes && baseSch.startTime && baseSch.endTime) {
      const startTime = parseTime(baseSch.startTime)
      let endTime = parseTime(baseSch.endTime)
      if (startTime !== null && endTime !== null) {
        if (endTime < startTime) endTime += 1440

        const headway = baseSch.headwayMinutes
        const numTrips = Math.floor((endTime - startTime) / headway) + 1

        for (let k = 0; k < numTrips; k++) {
          const tripStopTimes: (number | null)[] = []
          for (const stopId of direction.stopIds) {
            const sch = intervalSchedules.find((s) => s.stopId === stopId)
            if (sch && sch.startTime) {
              const st = parseTime(sch.startTime)
              if (st !== null) {
                tripStopTimes.push(st + k * headway)
                continue
              }
            }
            tripStopTimes.push(null)
          }

          interpolateMissingTimes(tripStopTimes, stopRatios)
          baseTrips.push(tripStopTimes as number[])
        }
      }
    }
  } else {
    // Exact schedules
    const exactSchedules = daily.filter((s) => s.type === 'exact')
    if (exactSchedules.length > 0) {
      const byStop = new Map<string, number[]>()
      for (const sch of exactSchedules) {
        if (!sch.stopId || !sch.departureTime) continue
        const t = parseTime(sch.departureTime)
        if (t !== null) {
          if (!byStop.has(sch.stopId)) byStop.set(sch.stopId, [])
          byStop.get(sch.stopId)!.push(t)
        }
      }

      for (const times of byStop.values()) {
        times.sort((a, b) => a - b)
      }

      let numTrips = 0
      for (const stopId of direction.stopIds) {
        const times = byStop.get(stopId)
        if (times && times.length > numTrips) numTrips = times.length
      }

      for (let k = 0; k < numTrips; k++) {
        const tripStopTimes: (number | null)[] = []
        for (const stopId of direction.stopIds) {
          const times = byStop.get(stopId)
          if (times && k < times.length) {
            let t = times[k]!
            // Adjust for midnight crossing in exact schedules if needed
            if (tripStopTimes.length > 0) {
               const prevTime = tripStopTimes[tripStopTimes.length - 1]
               if (prevTime !== null && t < prevTime && prevTime - t > 720) t += 1440
            }
            tripStopTimes.push(t)
          } else {
            tripStopTimes.push(null)
          }
        }
        interpolateMissingTimes(tripStopTimes, stopRatios)
        baseTrips.push(tripStopTimes as number[])
      }
    }
  }

  // Cross-day trips replication
  const allTrips: ActiveTrip[] = []
  for (let i = 0; i < baseTrips.length; i++) {
    const trip = baseTrips[i]!
    allTrips.push({ id: `${direction.id}-trip-${i}-base`, times: trip })
    allTrips.push({ id: `${direction.id}-trip-${i}-prev`, times: trip.map((t) => t - 1440) })
    allTrips.push({ id: `${direction.id}-trip-${i}-next`, times: trip.map((t) => t + 1440) })
  }
  return allTrips
}

function initBusAnimations() {
  const { weekday } = getCurrentDayAndMinutes()

  transit.routeStops.routes.forEach((route) => {
    route.directions.forEach((direction) => {
      const coords = getRouteCoordinates(direction)
      if (coords.length < 2) return

      const stopCoords = direction.stopIds
        .map((id) => transit.stopsById.get(id)?.geometry.coordinates)
        .filter((c): c is number[] => Boolean(c))

      if (stopCoords.length !== direction.stopIds.length) return

      const stopRatios = mapStopsToPath(coords, stopCoords)
      const trips = buildTrips(direction, weekday, stopRatios)
      if (!trips.length) return

      const segLengths = buildSegmentLengths(coords)

      activeDirections.push({
        directionId: direction.id,
        routeColor: route.color,
        routeNumber: route.number,
        coords,
        segLengths,
        stopRatios,
        trips,
      })
    })
  })

  if (activeDirections.length > 0) {
    globalAnimationFrame = requestAnimationFrame(tickGlobal)
  }
}

function tickGlobal() {
  if (!map) return

  const { minutes: nowMinutes } = getCurrentDayAndMinutes()
  const selectedKey = transit.selectedRouteKey
  const selectedDirId = selectedKey ? selectedKey.split('::')[1] : null

  const currentlyActiveTripIds = new Set<string>()

  for (const dir of activeDirections) {
    const isVisible = !selectedDirId || dir.directionId === selectedDirId

    const activeTrips = dir.trips.filter(
      (t) => t.times.length > 1 && nowMinutes >= t.times[0]! && nowMinutes <= t.times[t.times.length - 1]!,
    )

    for (const tripObj of activeTrips) {
      currentlyActiveTripIds.add(tripObj.id)
      const trip = tripObj.times

      let markerObj = busAnimations.get(tripObj.id)
      if (!markerObj) {
        const el = document.createElement('div')
        el.className = 'bus-badge'
        el.textContent = dir.routeNumber
        el.style.backgroundColor = dir.routeColor
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat(dir.coords[0] as [number, number])
          .addTo(map)
        markerObj = { el, marker }
        busAnimations.set(tripObj.id, markerObj)
      }

      markerObj.el.style.display = isVisible ? '' : 'none'
      if (!isVisible) continue

      let j = 0
      while (j < trip.length - 2 && nowMinutes > trip[j + 1]!) {
        j++
      }

      const t1 = trip[j]!
      const t2 = trip[j + 1]!
      const r1 = dir.stopRatios[j]!
      const r2 = dir.stopRatios[j + 1]!

      let fraction = 0
      if (t2 > t1) fraction = (nowMinutes - t1) / (t2 - t1)
      fraction = Math.max(0, Math.min(1, fraction))

      const targetRatio = r1 + fraction * (r2 - r1)
      const [lng, lat] = interpolateAlong(dir.coords, dir.segLengths, targetRatio)

      markerObj.marker.setLngLat([lng, lat])
    }
  }

  for (const [tripId, anim] of busAnimations.entries()) {
    if (!currentlyActiveTripIds.has(tripId)) {
      anim.marker.remove()
      busAnimations.delete(tripId)
    }
  }

  globalAnimationFrame = requestAnimationFrame(tickGlobal)
}

function stopBusAnimation() {
  if (globalAnimationFrame !== null) {
    cancelAnimationFrame(globalAnimationFrame)
    globalAnimationFrame = null
  }
  for (const anim of busAnimations.values()) {
    anim.marker.remove()
  }
  busAnimations.clear()
  activeDirections.splice(0, activeDirections.length)
}

// ─── Геолокация (expose) ──────────────────────────────────────────────────────

function showUserLocation(longitude: number, latitude: number) {
  if (!map) return

  const point: Feature<Point> = {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Point',
      coordinates: [longitude, latitude],
    },
  }

  const source = map.getSource('user-location') as maplibregl.GeoJSONSource | undefined
  if (source) {
    source.setData(point)
  } else if (map.isStyleLoaded()) {
    map.addSource('user-location', { type: 'geojson', data: point })
    map.addLayer({
      id: 'user-location-accuracy',
      type: 'circle',
      source: 'user-location',
      paint: {
        'circle-radius': 18,
        'circle-color': '#0074dc',
        'circle-opacity': 0.16,
      },
    })
    map.addLayer({
      id: 'user-location',
      type: 'circle',
      source: 'user-location',
      paint: {
        'circle-radius': 7,
        'circle-color': '#0074dc',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 3,
      },
    })
  }

  map.easeTo({
    center: [longitude, latitude],
    zoom: Math.max(map.getZoom(), 15),
    duration: 500,
    padding: { top: 72, right: 16, bottom: 180, left: 16 },
  })
}

defineExpose({ showUserLocation })

onBeforeUnmount(() => {
  stopBusAnimation()
  map?.remove()
  map = null
})
</script>

<template>
  <div ref="mapContainer" class="absolute inset-0" aria-label="Карта остановок и маршрутов" />
</template>
