<script setup lang="ts">
import type { Feature, Point } from 'geojson'
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { markerScaleForZoom } from '@/lib/map-scale'
import { buildRouteLines, decodePolyline } from '@/lib/route-geometry'
import { buildTrips, type ActiveTrip } from '@/lib/trips'
import { useRideStore } from '@/stores/ride'
import { useSettingsStore } from '@/stores/settings'
import { useTransitStore } from '@/stores/transit'
import type { RouteDirection } from '@/types/transit'

const emit = defineEmits<{
  vehicleClick: [vehicleId: string]
}>()

const transit = useTransitStore()
const ride = useRideStore()
const settings = useSettingsStore()
const mapContainer = ref<HTMLElement | null>(null)
let map: MapLibreMap | null = null
let animationFrame: number | null = null
let followActiveVehicle = true
let lastCameraUpdate = 0

interface BusMarker {
  marker: maplibregl.Marker
  element: HTMLElement
  scaleElement: HTMLElement
  vehicleId: string
}

interface AnimatedDirection {
  routeId: string
  directionId: string
  routeNumber: string
  routeColor: string
  coordinates: number[][]
  segmentLengths: number[]
  stopRatios: number[]
  trips: ActiveTrip[]
}

const busMarkers = new Map<string, BusMarker>()
const animatedDirections: AnimatedDirection[] = []

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
  map.on('zoomend', applyMarkerScale)
  map.on('dragstart', () => {
    if (ride.isActive) followActiveVehicle = false
  })

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
      filter: ['==', ['get', 'directionId'], ''],
      paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.85 },
    })
    map.addLayer({
      id: 'route-lines',
      type: 'line',
      source: 'route-lines',
      filter: ['==', ['get', 'directionId'], ''],
      paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-opacity': 0.9 },
    })

    map.addSource('stops', { type: 'geojson', data: transit.stops })
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
      if (ride.isActive) return
      const stopId = event.features?.[0]?.properties?.id as string | undefined
      if (stopId) transit.selectStop(stopId)
    })

    initialiseAnimations()
    applyMarkerScale()
    updateRouteVisibility()
  })
})

watch(
  () => transit.selectedStopId,
  (stopId) => {
    if (!map?.getLayer('selected-stop')) return
    map.setFilter('selected-stop', ['==', ['get', 'id'], stopId ?? ''])
    if (ride.isActive) return

    const stop = stopId ? transit.stopsById.get(stopId) : null
    if (!stop) return
    map.easeTo({
      center: stop.geometry.coordinates as [number, number],
      zoom: Math.max(map.getZoom(), 14.2),
      duration: 500,
      padding: { top: 80, right: 30, bottom: 280, left: 30 },
    })
  },
)

watch(
  [() => transit.selectedRouteKey, () => ride.activeRide],
  () => {
    if (ride.isActive) followActiveVehicle = true
    updateRouteVisibility()
  },
  { deep: true },
)

function updateRouteVisibility() {
  if (!map?.getLayer('route-lines')) return
  const directionId = ride.activeRide?.directionId ?? transit.selectedRouteKey?.split('::')[1] ?? ''
  map.setFilter('route-line-outline', ['==', ['get', 'directionId'], directionId])
  map.setFilter('route-lines', ['==', ['get', 'directionId'], directionId])
}

function applyMarkerScale() {
  if (!map) return
  const scale = markerScaleForZoom(map.getZoom()).toString()
  for (const marker of busMarkers.values()) {
    marker.scaleElement.style.setProperty('--map-marker-scale', scale)
  }
}

function routeCoordinates(direction: RouteDirection): number[][] {
  if (direction.geometry) return direction.geometry.coordinates
  if (direction.path) return decodePolyline(direction.path.value, direction.path.precision)
  return direction.stopIds
    .map((stopId) => transit.stopsById.get(stopId)?.geometry.coordinates)
    .filter((coordinates): coordinates is number[] => Boolean(coordinates))
}

function segmentLengths(coordinates: number[][]) {
  return coordinates.slice(0, -1).map((point, index) => {
    const next = coordinates[index + 1]!
    return Math.hypot(next[0]! - point[0]!, next[1]! - point[1]!)
  })
}

function interpolate(coordinates: number[][], lengths: number[], ratio: number): [number, number] {
  const total = lengths.reduce((sum, length) => sum + length, 0)
  let remaining = Math.max(0, Math.min(1, ratio)) * total

  for (let index = 0; index < lengths.length; index++) {
    const length = lengths[index]!
    if (remaining <= length || index === lengths.length - 1) {
      const progress = length > 0 ? remaining / length : 0
      const from = coordinates[index]!
      const to = coordinates[index + 1]!
      return [
        from[0]! + (to[0]! - from[0]!) * progress,
        from[1]! + (to[1]! - from[1]!) * progress,
      ]
    }
    remaining -= length
  }

  return coordinates.at(-1) as [number, number]
}

function bearing(from: [number, number], to: [number, number]) {
  const longitudeDelta = ((to[0] - from[0]) * Math.PI) / 180
  const latitude1 = (from[1] * Math.PI) / 180
  const latitude2 = (to[1] * Math.PI) / 180
  const y = Math.sin(longitudeDelta) * Math.cos(latitude2)
  const x =
    Math.cos(latitude1) * Math.sin(latitude2) -
    Math.sin(latitude1) * Math.cos(latitude2) * Math.cos(longitudeDelta)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

function mapStopsToPath(coordinates: number[][], stopCoordinates: number[][]): number[] | null {
  const cumulative = [0]
  for (let index = 0; index < coordinates.length - 1; index++) {
    const from = coordinates[index]!
    const to = coordinates[index + 1]!
    cumulative.push(cumulative[index]! + Math.hypot(to[0]! - from[0]!, to[1]! - from[1]!))
  }
  const total = cumulative.at(-1)!
  if (!total) return stopCoordinates.map(() => 0)

  const result: number[] = []
  let startIndex = 0
  for (const stop of stopCoordinates) {
    let bestDistance = Number.POSITIVE_INFINITY
    let bestRatio = cumulative[startIndex]! / total
    let bestIndex = startIndex

    for (let index = startIndex; index < coordinates.length - 1; index++) {
      const from = coordinates[index]!
      const to = coordinates[index + 1]!
      const dx = to[0]! - from[0]!
      const dy = to[1]! - from[1]!
      const lengthSquared = dx * dx + dy * dy
      const progress = lengthSquared
        ? Math.max(0, Math.min(1, ((stop[0]! - from[0]!) * dx + (stop[1]! - from[1]!) * dy) / lengthSquared))
        : 0
      const projectedX = from[0]! + progress * dx
      const projectedY = from[1]! + progress * dy
      const distance = (stop[0]! - projectedX) ** 2 + (stop[1]! - projectedY) ** 2
      if (distance < bestDistance) {
        bestDistance = distance
        bestIndex = index
        bestRatio = (cumulative[index]! + progress * Math.sqrt(lengthSquared)) / total
      }
    }

    if (result.length && bestRatio < result.at(-1)!) return null
    result.push(bestRatio)
    startIndex = bestIndex
  }
  return result
}

function currentServiceTime() {
  const now = new Date()
  const shifted = new Date(now.getTime() + (3 + settings.timeOffsetHours) * 60 * 60 * 1000)
  const weekday = shifted.getUTCDay() === 0 ? 7 : shifted.getUTCDay()
  return {
    weekday,
    minutes:
      shifted.getUTCHours() * 60 +
      shifted.getUTCMinutes() +
      shifted.getUTCSeconds() / 60 +
      shifted.getUTCMilliseconds() / 60000,
    serviceDate: shifted.toISOString().slice(0, 10),
  }
}

function initialiseAnimations() {
  const { weekday } = currentServiceTime()
  for (const route of transit.routeStops.routes) {
    for (const direction of route.directions) {
      const coordinates = routeCoordinates(direction)
      if (coordinates.length < 2) continue
      const stops = direction.stopIds
        .map((stopId) => transit.stopsById.get(stopId)?.geometry.coordinates)
        .filter((point): point is number[] => Boolean(point))
      if (stops.length !== direction.stopIds.length) continue
      const stopRatios = mapStopsToPath(coordinates, stops)
      if (!stopRatios) continue
      const trips = buildTrips(route.routeId, direction, weekday)
      if (!trips.length) continue
      animatedDirections.push({
        routeId: route.routeId,
        directionId: direction.id,
        routeNumber: route.number,
        routeColor: route.color,
        coordinates,
        segmentLengths: segmentLengths(coordinates),
        stopRatios,
        trips,
      })
    }
  }
  animationFrame = requestAnimationFrame(tick)
}

function createMarker(tripId: string, vehicleId: string, direction: AnimatedDirection) {
  if (!map) throw new Error('Map is not ready')
  const container = document.createElement('button')
  container.type = 'button'
  container.className = 'bus-badge-container'
  container.setAttribute('aria-label', `Автобус ${direction.routeNumber}`)
  const scaleElement = document.createElement('span')
  scaleElement.className = 'bus-badge-scale'
  scaleElement.style.setProperty('--map-marker-scale', markerScaleForZoom(map.getZoom()).toString())
  const element = document.createElement('span')
  element.className = 'bus-badge'
  element.style.backgroundColor = direction.routeColor
  element.textContent = direction.routeNumber
  scaleElement.appendChild(element)
  container.appendChild(scaleElement)
  container.addEventListener('click', (event) => {
    event.stopPropagation()
    emit('vehicleClick', vehicleId)
  })
  const marker = new maplibregl.Marker({ element: container, anchor: 'center' })
    .setLngLat(direction.coordinates[0] as [number, number])
    .addTo(map)
  const result = { marker, element, scaleElement, vehicleId }
  busMarkers.set(tripId, result)
  return result
}

function tick() {
  if (!map) return
  const { minutes: nowMinutes, serviceDate } = currentServiceTime()
  const activeRide = ride.activeRide
  const visibleTripIds = new Set<string>()
  const vehicleById = new Map(transit.vehicles.map((vehicle) => [vehicle.id, vehicle]))

  for (const direction of animatedDirections) {
    for (const trip of direction.trips) {
      if (trip.times.length < 2) continue
      const start = trip.times[0]!
      const end = trip.times.at(-1)!
      const startLabel = `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(Math.floor(start % 60)).padStart(2, '0')}`
      const vehicleId = `${serviceDate}::${direction.routeId}::${direction.directionId}::${startLabel}`
      const vehicle = vehicleById.get(vehicleId)
      const effectiveNow = nowMinutes - (vehicle?.delaySeconds ?? 0) / 60
      if (effectiveNow < start || effectiveNow > end) continue

      const isActiveVehicle = Boolean(
        activeRide &&
          activeRide.routeId === direction.routeId &&
          activeRide.directionId === direction.directionId &&
          activeRide.vehicleInstanceId === vehicleId,
      )
      const isVisible = activeRide
        ? isActiveVehicle
        : !transit.selectedRouteKey || transit.selectedRouteKey.endsWith(`::${direction.directionId}`)
      if (!isVisible) continue

      visibleTripIds.add(trip.id)
      const marker = busMarkers.get(trip.id) ?? createMarker(trip.id, vehicleId, direction)
      marker.vehicleId = vehicleId
      marker.element.style.opacity = vehicle?.state === 'observed' ? '1' : vehicle?.state === 'stale' ? '0.7' : '0.5'
      marker.element.textContent = vehicle?.confirmationCount
        ? `${direction.routeNumber} · ${vehicle.confirmationCount}✓`
        : direction.routeNumber

      let stopIndex = 0
      while (stopIndex < trip.times.length - 2 && effectiveNow > trip.times[stopIndex + 1]!) stopIndex++
      const fromTime = trip.times[stopIndex]!
      const toTime = trip.times[stopIndex + 1]!
      const progress = toTime > fromTime ? Math.max(0, Math.min(1, (effectiveNow - fromTime) / (toTime - fromTime))) : 0
      const ratio = direction.stopRatios[stopIndex]! + progress * (direction.stopRatios[stopIndex + 1]! - direction.stopRatios[stopIndex]!)
      const position = interpolate(direction.coordinates, direction.segmentLengths, ratio)
      const ahead = interpolate(direction.coordinates, direction.segmentLengths, Math.min(1, ratio + 0.002))
      marker.marker.setLngLat(position)

      if (isActiveVehicle && followActiveVehicle && Date.now() - lastCameraUpdate > 250) {
        lastCameraUpdate = Date.now()
        map.easeTo({
          center: position,
          bearing: bearing(position, ahead),
          pitch: 48,
          zoom: Math.max(map.getZoom(), 16.2),
          duration: 300,
          padding: { top: 90, right: 24, bottom: 250, left: 24 },
        })
      }
    }
  }

  for (const [tripId, marker] of busMarkers) {
    const visible = visibleTripIds.has(tripId)
    marker.marker.getElement().style.display = visible ? '' : 'none'
  }

  animationFrame = requestAnimationFrame(tick)
}

function showUserLocation(longitude: number, latitude: number) {
  if (!map || ride.isActive) return
  const point: Feature<Point> = {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates: [longitude, latitude] },
  }
  const source = map.getSource('user-location') as maplibregl.GeoJSONSource | undefined
  if (source) source.setData(point)
  else if (map.isStyleLoaded()) {
    map.addSource('user-location', { type: 'geojson', data: point })
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
  map.easeTo({ center: [longitude, latitude], zoom: Math.max(map.getZoom(), 15), duration: 500 })
}

function resumeRideFollowing() {
  followActiveVehicle = true
}

defineExpose({ showUserLocation, resumeRideFollowing })

onBeforeUnmount(() => {
  if (animationFrame !== null) cancelAnimationFrame(animationFrame)
  for (const marker of busMarkers.values()) marker.marker.remove()
  busMarkers.clear()
  map?.remove()
  map = null
})
</script>

<template>
  <div ref="mapContainer" class="absolute inset-0" aria-label="Карта остановок и маршрутов" />
</template>
