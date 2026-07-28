<script setup lang="ts">
import type { Feature, Point } from 'geojson'
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { buildRouteLines, decodePolyline } from '@/lib/route-geometry'
import { markerScaleForZoom } from '@/lib/map-scale'
import { useSettingsStore } from '@/stores/settings'
import { useTransitStore } from '@/stores/transit'
import type { RouteDirection } from '@/types/transit'

const transit = useTransitStore()
const settings = useSettingsStore()
const mapContainer = ref<HTMLElement | null>(null)
let map: MapLibreMap | null = null

interface BusAnimation {
  marker: maplibregl.Marker
  el: HTMLElement
  scaleElement: HTMLElement
}
const busAnimations = new Map<string, BusAnimation>()
let globalAnimationFrame: number | null = null

import { buildTrips, type ActiveTrip } from '@/lib/trips'

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
  map.on('zoomend', applyMapMarkerScale)

  map.on('load', () => {
    if (!map) return
    const routeStopIds = transit.routeStops.routes.flatMap((route) =>
      route.directions.flatMap((direction) => direction.stopIds),
    )

    map.addSource('route-lines', {
      type: 'geojson',
      data: buildRouteLines(transit.routeStops.routes, transit.stopsById),
      tolerance: 0,
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
        'circle-radius': ['step', ['zoom'], 4, 12.5, 6, 14, 8, 15.5, 10],
        'circle-color': '#ffffff',
        'circle-opacity': 0.96,
        'circle-stroke-color': '#d5d9de',
        'circle-stroke-width': ['step', ['zoom'], 0.5, 14, 1],
      },
    })
    map.addLayer({
      id: 'stops',
      type: 'circle',
      source: 'stops',
      paint: {
        'circle-radius': ['step', ['zoom'], 2, 12.5, 3, 14, 4, 15.5, 5],
        'circle-color': '#1f2933',
      },
    })
    map.addLayer({
      id: 'route-stops',
      type: 'circle',
      source: 'stops',
      filter: ['in', ['get', 'id'], ['literal', routeStopIds]],
      paint: {
        'circle-radius': ['step', ['zoom'], 3, 12.5, 4, 14, 5, 15.5, 6],
        'circle-color': '#0074dc',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': ['step', ['zoom'], 1, 14, 1.5, 15.5, 2],
      },
    })
    map.addLayer({
      id: 'selected-stop',
      type: 'circle',
      source: 'stops',
      filter: ['==', ['get', 'id'], ''],
      paint: {
        'circle-radius': ['step', ['zoom'], 8, 12.5, 10, 14, 12, 15.5, 15],
        'circle-color': '#0074dc',
        'circle-opacity': 0.2,
        'circle-stroke-color': '#0074dc',
        'circle-stroke-width': ['step', ['zoom'], 1, 14, 1.5, 15.5, 2],
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
    applyMapMarkerScale()
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

function applyMapMarkerScale() {
  if (!map) return
  const scale = markerScaleForZoom(map.getZoom()).toString()
  for (const animation of busAnimations.values()) {
    animation.scaleElement.style.setProperty('--map-marker-scale', scale)
  }
}

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
    const dx = coords[i + 1]![0]! - coords[i]![0]!
    const dy = coords[i + 1]![1]! - coords[i]![1]!
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

function getCurrentDayAndMinutes() {
  const d = new Date()
  const offsetMs = settings.timeOffsetHours * 60 * 60 * 1000
  const moscowMs = d.getTime() + 3 * 60 * 60 * 1000 + offsetMs
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

function mapStopsToPath(coords: number[][], stopCoords: number[][]): number[] | null {
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

  for (let k = 0; k < stopCoords.length; k++) {
    const stop = stopCoords[k]!
    let minDist = Infinity
    let bestRatio = lengths[searchStartIndex]! / totalLength
    let bestSegmentIndex = searchStartIndex
    let distanceIncreasedCount = 0

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
        distanceIncreasedCount = 0
      } else {
        distanceIncreasedCount++
        if (distanceIncreasedCount > 10) {
          break
        }
      }
    }

    searchStartIndex = bestSegmentIndex
    if (k > 0 && bestRatio < mapped[k - 1]!) {
      return null
    }
    mapped.push(bestRatio)
  }
  return mapped
}

function initBusAnimations() {
  const { weekday } = getCurrentDayAndMinutes()

  transit.routeStops.routes.forEach((route) => {
    route.directions.forEach((direction) => {
      let coords = getRouteCoordinates(direction)
      if (coords.length < 2) return

      const stopCoords = direction.stopIds
        .map((id) => transit.stopsById.get(id)?.geometry.coordinates)
        .filter((c): c is number[] => Boolean(c))

      if (stopCoords.length !== direction.stopIds.length) return

      const segLengths = buildSegmentLengths(coords)
      const stopRatios = mapStopsToPath(coords, stopCoords)
      if (!stopRatios) {
        if (settings.debugMode) {
          console.warn(
            `[Debug] Skipped route ${route.routeId} direction ${direction.id}: Invalid geometry matching (stops out of order on path).`,
          )
        }
        return
      }

      const trips = buildTrips(route.routeId, direction, weekday)
      if (!trips.length) return

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

let lastDebugPrint = 0

function tickGlobal() {
  if (!map) return

  const { minutes: nowMinutes } = getCurrentDayAndMinutes()
  const selectedKey = transit.selectedRouteKey
  const selectedDirId = selectedKey ? selectedKey.split('::')[1] : null

  const currentlyActiveTripIds = new Set<string>()
  const updatesThisFrame = new Map<string, number>()
  const shouldPrintDebug = settings.debugMode && Date.now() - lastDebugPrint > 2000
  if (shouldPrintDebug) {
    lastDebugPrint = Date.now()
    console.log(
      `[Debug] tickGlobal | nowMinutes: ${nowMinutes.toFixed(2)} | selectedDirId: ${selectedDirId}`,
    )
  }

  const vehicleMap = new Map<string, (typeof transit.vehicles)[0]>()
  for (const v of transit.vehicles) {
    vehicleMap.set(v.id, v)
  }
  const serviceDateStr = new Date().toISOString().split('T')[0]!

  for (const dir of activeDirections) {
    const isVisible = !selectedDirId || dir.directionId === selectedDirId

    const activeTrips = dir.trips.filter((t) => {
      if (t.times.length <= 1) return false
      // Fast filter: only check trips within +/- 120 mins of now (to account for extreme delays)
      if (nowMinutes < t.times[0]! - 120 || nowMinutes > t.times[t.times.length - 1]! + 120)
        return false

      const scheduledTimeStr = `${Math.floor(t.times[0]! / 60)
        .toString()
        .padStart(2, '0')}:${Math.floor(t.times[0]! % 60)
        .toString()
        .padStart(2, '0')}`
      const routeId = t.id.split('::')[0]!
      const actualVehicleId = `${serviceDateStr}::${routeId}::${dir.directionId}::${scheduledTimeStr}`
      const realVehicle = vehicleMap.get(actualVehicleId)

      let effectiveNow = nowMinutes
      if (realVehicle && realVehicle.delaySeconds) {
        effectiveNow -= realVehicle.delaySeconds / 60
      }

      return effectiveNow >= t.times[0]! && effectiveNow <= t.times[t.times.length - 1]!
    })

    if (shouldPrintDebug && isVisible && activeTrips.length > 0) {
      console.log(
        `[Debug]   Dir: ${dir.routeNumber} (${dir.directionId}) | Active Trips: ${activeTrips.length}`,
      )
    }

    for (const tripObj of activeTrips) {
      currentlyActiveTripIds.add(tripObj.id)
      const updates = (updatesThisFrame.get(tripObj.id) || 0) + 1
      updatesThisFrame.set(tripObj.id, updates)
      if (updates > 1) {
        console.warn(`[Debug] Collision: Marker updated multiple times per frame: ${tripObj.id}`)
      }

      const trip = tripObj.times

      if (shouldPrintDebug && isVisible) {
        console.log(
          `[Debug]     Trip ${tripObj.id} is active (Time range: ${tripObj.times[0]} - ${tripObj.times[tripObj.times.length - 1]})`,
        )
      }

      let markerObj = busAnimations.get(tripObj.id)
      if (!markerObj) {
        const container = document.createElement('div')
        container.className = 'bus-badge-container'
        const scaleElement = document.createElement('div')
        scaleElement.className = 'bus-badge-scale'
        scaleElement.style.setProperty(
          '--map-marker-scale',
          markerScaleForZoom(map.getZoom()).toString(),
        )
        const el = document.createElement('div')
        el.className = 'bus-badge'
        el.style.backgroundColor = dir.routeColor
        scaleElement.appendChild(el)
        container.appendChild(scaleElement)
        const marker = new maplibregl.Marker({ element: container, anchor: 'center' })
          .setLngLat(dir.coords[0] as [number, number])
          .addTo(map)
        markerObj = { el, marker, scaleElement }
        busAnimations.set(tripObj.id, markerObj)
      }

      if (settings.debugMode) {
        const tripIdx = tripObj.id.split('-').slice(-2, -1)[0]
        markerObj.el.textContent = `${dir.routeNumber} · ${tripIdx}`
      } else {
        markerObj.el.textContent = dir.routeNumber
      }

      markerObj.el.style.display = isVisible ? '' : 'none'
      if (!isVisible) continue

      const scheduledTimeStr = `${Math.floor(trip[0]! / 60)
        .toString()
        .padStart(2, '0')}:${Math.floor(trip[0]! % 60)
        .toString()
        .padStart(2, '0')}`
      const routeId = tripObj.id.split('::')[0]!
      const actualVehicleId = `${serviceDateStr}::${routeId}::${dir.directionId}::${scheduledTimeStr}`
      const realVehicle = vehicleMap.get(actualVehicleId)

      let effectiveNow = nowMinutes
      let opacity = 0.5
      let count = 0

      if (realVehicle && (realVehicle.state === 'observed' || realVehicle.state === 'stale')) {
        opacity = realVehicle.state === 'observed' ? 1.0 : 0.7
        count = realVehicle.confirmationCount
        if (realVehicle.delaySeconds) {
          effectiveNow -= realVehicle.delaySeconds / 60
        }
      }

      let j = 0
      while (j < trip.length - 2 && effectiveNow > trip[j + 1]!) {
        j++
      }

      const t1 = trip[j]!
      const t2 = trip[j + 1]!
      const r1 = dir.stopRatios[j]!
      const r2 = dir.stopRatios[j + 1]!

      let fraction = 0
      if (t2 > t1) fraction = (effectiveNow - t1) / (t2 - t1)
      fraction = Math.max(0, Math.min(1, fraction))

      const targetRatio = r1 + fraction * (r2 - r1)
      const interpolated = interpolateAlong(dir.coords, dir.segLengths, targetRatio)
      const lng = interpolated[0]
      const lat = interpolated[1]

      markerObj.marker.setLngLat([lng, lat])
      markerObj.el.style.opacity = opacity.toString()

      if (count > 0) {
        markerObj.el.textContent = `${dir.routeNumber} · ${count}✓`
        markerObj.el.style.fontWeight = 'bold'
      } else {
        markerObj.el.textContent = dir.routeNumber
        markerObj.el.style.fontWeight = 'normal'
      }
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
