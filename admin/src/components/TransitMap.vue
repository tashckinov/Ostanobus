<script setup lang="ts">
import type { FeatureCollection, LineString, Point } from 'geojson'
import maplibregl, { type GeoJSONSource, type Map } from 'maplibre-gl'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { Stop } from '../types'

const props = defineProps<{
  stops: Stop[]
  geometry?: LineString | null
  selectedStopId?: string | null
  routingPoints?: Array<{ longitude: number; latitude: number }>
}>()

const emit = defineEmits<{
  stopClick: [stop: Stop]
  mapClick: [longitude: number, latitude: number]
}>()

const container = ref<HTMLElement | null>(null)
let map: Map | null = null

function stopsGeoJson(): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: props.stops.map((stop) => ({
      type: 'Feature',
      properties: { ...stop },
      geometry: { type: 'Point', coordinates: [stop.longitude, stop.latitude] },
    })),
  }
}

function routeGeoJson(): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    features: props.geometry ? [{ type: 'Feature', properties: {}, geometry: props.geometry }] : [],
  }
}

function routingPointsGeoJson(): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: (props.routingPoints ?? []).map((point, index) => ({
      type: 'Feature',
      properties: { index: index + 1 },
      geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] },
    })),
  }
}

onMounted(() => {
  if (!container.value) return
  map = new maplibregl.Map({
    container: container.value,
    center: [42.216, 47.531],
    zoom: 13.5,
    style: {
      version: 8,
      sources: {
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '© OpenStreetMap contributors',
        },
      },
      layers: [{ id: 'osm', source: 'osm', type: 'raster' }],
    },
  })
  map.addControl(new maplibregl.NavigationControl(), 'top-right')
  map.on('load', () => {
    if (!map) return
    map.addSource('route', { type: 'geojson', data: routeGeoJson() })
    map.addLayer({
      id: 'route-outline',
      type: 'line',
      source: 'route',
      paint: { 'line-color': '#ffffff', 'line-width': 7 },
    })
    map.addLayer({
      id: 'route',
      type: 'line',
      source: 'route',
      paint: { 'line-color': '#006fca', 'line-width': 4 },
    })
    map.addSource('stops', { type: 'geojson', data: stopsGeoJson() })
    map.addLayer({
      id: 'stops',
      type: 'circle',
      source: 'stops',
      paint: {
        'circle-radius': ['case', ['==', ['get', 'id'], props.selectedStopId ?? ''], 9, 6],
        'circle-color': ['case', ['get', 'active'], '#17212b', '#9ca3af'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    })
    map.addSource('routing-points', {
      type: 'geojson',
      data: routingPointsGeoJson(),
    })
    map.addLayer({
      id: 'routing-points',
      type: 'circle',
      source: 'routing-points',
      paint: {
        'circle-radius': 7,
        'circle-color': '#f59e0b',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    })
    map.on('click', 'stops', (event) => {
      const stopId = event.features?.[0]?.properties?.id as string | undefined
      const stop = props.stops.find((item) => item.id === stopId)
      if (stop) emit('stopClick', stop)
    })
    map.on('click', (event) => {
      const features = map?.queryRenderedFeatures(event.point, { layers: ['stops'] })
      if (!features?.length) emit('mapClick', event.lngLat.lng, event.lngLat.lat)
    })
  })
})

watch(
  () => props.stops,
  () => (map?.getSource('stops') as GeoJSONSource | undefined)?.setData(stopsGeoJson()),
  { deep: true },
)
watch(
  () => props.geometry,
  () => (map?.getSource('route') as GeoJSONSource | undefined)?.setData(routeGeoJson()),
  { deep: true },
)
watch(
  () => props.routingPoints,
  () =>
    (map?.getSource('routing-points') as GeoJSONSource | undefined)?.setData(
      routingPointsGeoJson(),
    ),
  { deep: true },
)
watch(
  () => props.selectedStopId,
  (id) => {
    if (map?.getLayer('stops')) {
      map.setPaintProperty('stops', 'circle-radius', [
        'case',
        ['==', ['get', 'id'], id ?? ''],
        9,
        6,
      ])
    }
  },
)

onBeforeUnmount(() => map?.remove())
</script>

<template>
  <div ref="container" class="map" />
</template>
