import type { Feature, FeatureCollection, Point } from 'geojson'

export interface StopProperties {
  id: string
  name: string
  shortName: string
  osmId?: number
  osmUrl?: string
  shelter?: string | null
  bench?: string | null
  bus?: string | null
  trolleybus?: string | null
}

export type StopFeature = Feature<Point, StopProperties>
export type StopsCollection = FeatureCollection<Point, StopProperties>

export interface EncodedRoutePath {
  format: 'polyline'
  precision: number
  value: string
}

export interface RouteDirection {
  id: string
  name: string
  terminal: string
  stopIds: string[]
  distanceMeters?: number
  path?: EncodedRoutePath
}

export interface TransitRoute {
  routeId: string
  number: string
  color: string
  isMock?: boolean
  directions: RouteDirection[]
}

export interface RouteStopsData {
  routes: TransitRoute[]
}

export type ForecastConfidence = 'high' | 'medium' | 'low'

export interface Forecast {
  stopId: string
  routeId: string
  minMinutes: number
  maxMinutes: number
  confidence: ForecastConfidence
  sampleSize: number
}

export interface ForecastsData {
  generatedAt: string | null
  isMock: boolean
  forecasts: Forecast[]
}

export interface StopForecast extends Forecast {
  route: TransitRoute
}

export interface ActiveRide {
  id: 'current'
  routeId: string
  directionId: string
  nextStopIndex: number
  startedAt: string
}
