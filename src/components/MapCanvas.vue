<script setup lang="ts">
import type { Feature, Point } from 'geojson'
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { buildRouteLines } from '@/lib/route-geometry'
import { useTransitStore } from '@/stores/transit'
import type { RouteDirection, TransitRoute } from '@/types/transit'

const transit = useTransitStore()
const mapContainer = ref<HTMLElement | null>(null)
let map: MapLibreMap | null = null

interface BusAnimation {
  marker: maplibregl.Marker
  cancelFrame: number
  el: HTMLElement
}
const busAnimations = new Map<string, BusAnimation>()

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

    transit.routeStops.routes.forEach(route => {
      route.directions.forEach(direction => {
        startBusAnimation(route, direction)
      })
    })
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
      // Показать все бейджи
      for (const anim of busAnimations.values()) {
        anim.el.style.display = ''
      }
      return
    }

    const [, directionId] = key.split('::')
    map.setFilter('route-line-outline', ['==', ['get', 'directionId'], directionId ?? ''])
    map.setFilter('route-lines', ['==', ['get', 'directionId'], directionId ?? ''])

    // Оставить только бейдж выбранного направления
    for (const [dirId, anim] of busAnimations) {
      anim.el.style.display = dirId === directionId ? '' : 'none'
    }
  },
)

// ─── Анимированный badge ──────────────────────────────────────────────────────

function getRouteCoordinates(direction: RouteDirection): number[][] {
  if (direction.geometry) return direction.geometry.coordinates
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

function startBusAnimation(route: TransitRoute, direction: RouteDirection) {
  if (!map) return

  const coords = getRouteCoordinates(direction)
  if (coords.length < 2) return

  // Проверяем что есть хоть одно interval-расписание, если нет - 15 мин по умолчанию
  const intervalSchedules = (direction.schedules ?? []).filter((s) => s.type === 'interval' && s.headwayMinutes)
  const headway = intervalSchedules.length > 0 ? intervalSchedules[0]!.headwayMinutes! : 15 // минуты

  // Создаём HTML-элемент badge
  const el = document.createElement('div')
  el.className = 'bus-badge'
  el.textContent = route.number
  el.style.backgroundColor = route.color

  const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
    .setLngLat([coords[0]![0]!, coords[0]![1]!])
    .addTo(map)

  const segLengths = buildSegmentLengths(coords)
  const cycleDuration = headway * 60 * 1000 // мс — за headway минут баджик проходит весь маршрут
  const startTime = performance.now() - Math.random() * cycleDuration

  let cancelFrame = 0
  function tick(now: number) {
    const elapsed = (now - startTime) % cycleDuration
    const t = elapsed / cycleDuration
    const [lng, lat] = interpolateAlong(coords, segLengths, t)
    marker.setLngLat([lng, lat])
    cancelFrame = requestAnimationFrame(tick)
  }

  cancelFrame = requestAnimationFrame(tick)
  busAnimations.set(direction.id, { marker, cancelFrame, el })
}

function stopBusAnimation() {
  for (const anim of busAnimations.values()) {
    cancelAnimationFrame(anim.cancelFrame)
    anim.marker.remove()
  }
  busAnimations.clear()
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
