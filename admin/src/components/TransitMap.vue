<script setup lang="ts">
import type { FeatureCollection, LineString, Point } from 'geojson'
import maplibregl, { type GeoJSONSource, type Map } from 'maplibre-gl'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { RouteSegment, Stop } from '../types'

const props = defineProps<{
  stops: Stop[]
  segments?: RouteSegment[]
  selectedSegmentId?: string | null
  selectedStopId?: string | null
  selectedStopIds?: string[]
  viaPoints?: Array<{
    segmentId: string
    longitude: number
    latitude: number
  }>
  roadAnchors?: Array<{
    stopId: string
    longitude: number
    latitude: number
  }>
  activeRoadAnchor?: {
    stopId: string
    longitude: number
    latitude: number
  } | null
  manualDraftCoordinates?: number[][]
  interactionMode?: 'select' | 'via' | 'manual'
  routeColor?: string
}>()

const emit = defineEmits<{
  stopClick: [stop: Stop]
  segmentClick: [segmentId: string]
  mapClick: [longitude: number, latitude: number]
  roadAnchorMove: [stopId: string, longitude: number, latitude: number]
}>()

const container = ref<HTMLElement | null>(null)
let map: Map | null = null
let roadAnchorMarker: maplibregl.Marker | null = null

function stopCoordinate(stopId: string) {
  const anchor = props.roadAnchors?.find((item) => item.stopId === stopId)
  if (anchor) return [anchor.longitude, anchor.latitude]
  const stop = props.stops.find((item) => item.id === stopId)
  return stop ? [stop.longitude, stop.latitude] : null
}

function stopsGeoJson(): FeatureCollection<Point> {
  const selectedStopIds = props.selectedStopIds ?? []
  const selectedStops = new globalThis.Map(
    selectedStopIds.map((id, index) => {
      const label =
        index === 0 ? 'A' : index === selectedStopIds.length - 1 ? 'B' : String(index + 1)
      return [id, { order: index + 1, label }]
    }),
  )
  return {
    type: 'FeatureCollection',
    features: props.stops.map((stop) => {
      const selected = selectedStops.get(stop.id)
      return {
        type: 'Feature',
        properties: {
          ...stop,
          selectedOrder: selected?.order ?? 0,
          selectedLabel: selected?.label ?? '',
        },
        geometry: { type: 'Point', coordinates: [stop.longitude, stop.latitude] },
      }
    }),
  }
}

function segmentColor(segment: RouteSegment) {
  if (segment.id === props.selectedSegmentId) return '#1473e6'
  if (props.selectedSegmentId) return '#7b8794'
  if (!segment.geometry || segment.status === 'error') return '#dc2626'
  if (segment.status === 'fixed') return '#15803d'
  if (segment.mode === 'manual') return '#9333ea'
  if (segment.mode === 'automatic') return '#ea7b18'
  return '#7b8794'
}

function segmentsGeoJson(): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    features: (props.segments ?? []).flatMap((segment) => {
      const fallbackStart = stopCoordinate(segment.fromStopId)
      const fallbackEnd = stopCoordinate(segment.toStopId)
      const geometry =
        segment.geometry ??
        (fallbackStart && fallbackEnd
          ? ({ type: 'LineString', coordinates: [fallbackStart, fallbackEnd] } as LineString)
          : null)
      return geometry
        ? [
            {
              type: 'Feature' as const,
              properties: {
                id: segment.id,
                editorColor: segmentColor(segment),
                selected: segment.id === props.selectedSegmentId ? 1 : 0,
              },
              geometry,
            },
          ]
        : []
    }),
  }
}

function viaPointsGeoJson(): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: (props.viaPoints ?? []).map((point, index) => ({
      type: 'Feature',
      properties: { index: index + 1, segmentId: point.segmentId },
      geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] },
    })),
  }
}

function roadAnchorsGeoJson(): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: (props.roadAnchors ?? []).map((anchor) => ({
      type: 'Feature',
      properties: { stopId: anchor.stopId },
      geometry: { type: 'Point', coordinates: [anchor.longitude, anchor.latitude] },
    })),
  }
}

function anchorConnectorsGeoJson(): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    features: (props.roadAnchors ?? []).flatMap((anchor) => {
      const stop = props.stops.find((item) => item.id === anchor.stopId)
      if (!stop) return []
      return [
        {
          type: 'Feature' as const,
          properties: { stopId: anchor.stopId },
          geometry: {
            type: 'LineString' as const,
            coordinates: [
              [stop.longitude, stop.latitude],
              [anchor.longitude, anchor.latitude],
            ],
          },
        },
      ]
    }),
  }
}

function manualDraftGeoJson(): FeatureCollection<LineString> {
  const coordinates = props.manualDraftCoordinates ?? []
  return {
    type: 'FeatureCollection',
    features:
      coordinates.length >= 2
        ? [
            {
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates },
            },
          ]
        : [],
  }
}

function setSourceData(source: string, data: FeatureCollection) {
  ;(map?.getSource(source) as GeoJSONSource | undefined)?.setData(data)
}

function refreshMapData() {
  setSourceData('stops', stopsGeoJson())
  setSourceData('segments', segmentsGeoJson())
  setSourceData('via-points', viaPointsGeoJson())
  setSourceData('road-anchors', roadAnchorsGeoJson())
  setSourceData('anchor-connectors', anchorConnectorsGeoJson())
  setSourceData('manual-draft', manualDraftGeoJson())
}

function renderRoadAnchor() {
  roadAnchorMarker?.remove()
  roadAnchorMarker = null
  if (!map || !props.activeRoadAnchor) return

  const anchor = props.activeRoadAnchor
  const element = document.createElement('div')
  element.className = 'route-anchor-marker'
  element.title = 'Перетащите дорожный якорь на нужную полосу'

  roadAnchorMarker = new maplibregl.Marker({
    element,
    draggable: true,
    anchor: 'center',
  })
    .setLngLat([anchor.longitude, anchor.latitude])
    .addTo(map)

  roadAnchorMarker.on('dragend', () => {
    const position = roadAnchorMarker?.getLngLat()
    if (position) emit('roadAnchorMove', anchor.stopId, position.lng, position.lat)
  })
}

onMounted(() => {
  if (!container.value) return
  map = new maplibregl.Map({
    container: container.value,
    center: [42.216, 47.531],
    zoom: 13.5,
    style: {
      version: 8,
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
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
    map.addSource('anchor-connectors', { type: 'geojson', data: anchorConnectorsGeoJson() })
    map.addLayer({
      id: 'anchor-connectors',
      type: 'line',
      source: 'anchor-connectors',
      paint: { 'line-color': '#64748b', 'line-width': 1.5, 'line-dasharray': [2, 2] },
    })
    map.addSource('segments', { type: 'geojson', data: segmentsGeoJson() })
    map.addLayer({
      id: 'segments-outline',
      type: 'line',
      source: 'segments',
      paint: { 'line-color': '#ffffff', 'line-width': 8 },
    })
    map.addLayer({
      id: 'segments',
      type: 'line',
      source: 'segments',
      paint: {
        'line-color': ['get', 'editorColor'],
        'line-width': ['case', ['==', ['get', 'selected'], 1], 6, 4],
      },
    })
    map.addLayer({
      id: 'segment-arrows',
      type: 'symbol',
      source: 'segments',
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 90,
        'text-field': '▶',
        'text-size': 11,
        'text-keep-upright': false,
        'text-rotation-alignment': 'map',
      },
      paint: {
        'text-color': ['get', 'editorColor'],
        'text-halo-color': '#ffffff',
        'text-halo-width': 1,
      },
    })
    map.addSource('manual-draft', { type: 'geojson', data: manualDraftGeoJson() })
    map.addLayer({
      id: 'manual-draft',
      type: 'line',
      source: 'manual-draft',
      paint: { 'line-color': '#1473e6', 'line-width': 4, 'line-dasharray': [2, 2] },
    })
    map.addSource('stops', { type: 'geojson', data: stopsGeoJson() })
    map.addLayer({
      id: 'stops',
      type: 'circle',
      source: 'stops',
      paint: {
        'circle-radius': ['case', ['>', ['get', 'selectedOrder'], 0], 10, 6],
        'circle-color': [
          'case',
          ['>', ['get', 'selectedOrder'], 0],
          props.routeColor ?? '#006fca',
          ['get', 'active'],
          '#17212b',
          '#9ca3af',
        ],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    })
    map.addLayer({
      id: 'stop-order-labels',
      type: 'symbol',
      source: 'stops',
      filter: ['!=', ['get', 'selectedLabel'], ''],
      layout: {
        'text-field': ['get', 'selectedLabel'],
        'text-size': 10,
        'text-font': ['Open Sans Bold'],
      },
      paint: { 'text-color': '#ffffff' },
    })
    map.addSource('road-anchors', { type: 'geojson', data: roadAnchorsGeoJson() })
    map.addLayer({
      id: 'road-anchors',
      type: 'symbol',
      source: 'road-anchors',
      layout: { 'text-field': '◆', 'text-size': 16 },
      paint: {
        'text-color': '#0f766e',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1,
      },
    })
    map.addSource('via-points', { type: 'geojson', data: viaPointsGeoJson() })
    map.addLayer({
      id: 'via-points',
      type: 'symbol',
      source: 'via-points',
      layout: { 'text-field': '◆', 'text-size': 15 },
      paint: {
        'text-color': '#ea7b18',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1,
      },
    })
    renderRoadAnchor()

    map.on('click', 'stops', (event) => {
      const stopId = event.features?.[0]?.properties?.id as string | undefined
      const stop = props.stops.find((item) => item.id === stopId)
      if (stop) emit('stopClick', stop)
    })
    map.on('click', 'segments', (event) => {
      if (props.interactionMode === 'via' || props.interactionMode === 'manual') {
        emit('mapClick', event.lngLat.lng, event.lngLat.lat)
        return
      }
      const segmentId = event.features?.[0]?.properties?.id as string | undefined
      if (segmentId) emit('segmentClick', segmentId)
    })
    for (const layer of ['stops', 'segments']) {
      map.on('mouseenter', layer, () => {
        if (map) map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', layer, () => {
        if (map) map.getCanvas().style.cursor = ''
      })
    }
    map.on('click', (event) => {
      const features = map?.queryRenderedFeatures(event.point, {
        layers: ['stops', 'segments'],
      })
      if (!features?.length) emit('mapClick', event.lngLat.lng, event.lngLat.lat)
    })
  })
})

watch(
  [
    () => props.stops,
    () => props.segments,
    () => props.selectedSegmentId,
    () => props.selectedStopIds,
    () => props.viaPoints,
    () => props.roadAnchors,
    () => props.manualDraftCoordinates,
    () => props.interactionMode,
    () => props.routeColor,
  ],
  refreshMapData,
  { deep: true },
)
watch(() => props.activeRoadAnchor, renderRoadAnchor, { deep: true })

onBeforeUnmount(() => {
  roadAnchorMarker?.remove()
  map?.remove()
})
</script>

<template>
  <div ref="container" class="map" />
</template>
