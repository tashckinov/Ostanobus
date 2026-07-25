<script setup lang="ts">
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { useTransitStore } from '@/stores/transit'

const transit = useTransitStore()
const mapContainer = ref<HTMLElement | null>(null)
let map: MapLibreMap | null = null

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
    center: [42.169, 47.512],
    zoom: 13.5,
    minZoom: 11,
    maxZoom: 18,
    attributionControl: false,
  })

  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
  map.addControl(
    new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }),
    'bottom-right',
  )

  map.on('load', () => {
    if (!map) return

    map.addSource('routes', {
      type: 'geojson',
      data: transit.routes,
    })
    map.addLayer({
      id: 'route-shadow',
      type: 'line',
      source: 'routes',
      paint: {
        'line-color': '#ffffff',
        'line-opacity': 0.9,
        'line-width': 8,
      },
    })
    map.addLayer({
      id: 'routes',
      type: 'line',
      source: 'routes',
      paint: {
        'line-color': ['get', 'color'],
        'line-opacity': 0.9,
        'line-width': 4,
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
        'circle-stroke-color': '#d9ddcf',
        'circle-stroke-width': 1,
      },
    })
    map.addLayer({
      id: 'stops',
      type: 'circle',
      source: 'stops',
      paint: {
        'circle-radius': 5,
        'circle-color': '#173f35',
      },
    })
    map.addLayer({
      id: 'selected-stop',
      type: 'circle',
      source: 'stops',
      filter: ['==', ['get', 'id'], ''],
      paint: {
        'circle-radius': 15,
        'circle-color': '#f8d567',
        'circle-opacity': 0.35,
        'circle-stroke-color': '#173f35',
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
  })
})

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

onBeforeUnmount(() => {
  map?.remove()
  map = null
})
</script>

<template>
  <div ref="mapContainer" class="absolute inset-0" aria-label="Карта остановок и маршрутов" />
</template>
