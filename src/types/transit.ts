import type { Feature, FeatureCollection, LineString, Point } from 'geojson'

export interface StopProperties {
  id: string
  name: string
  shortName: string
}

export interface RouteProperties {
  id: string
  number: string
  color: string
  from: string
  to: string
}

export type StopFeature = Feature<Point, StopProperties>
export type RouteFeature = Feature<LineString, RouteProperties>
export type StopsCollection = FeatureCollection<Point, StopProperties>
export type RoutesCollection = FeatureCollection<LineString, RouteProperties>

export interface RouteDirection {
  id: string
  name: string
  terminal: string
  stopIds: string[]
}

export interface TransitRoute {
  routeId: string
  number: string
  color: string
  directions: RouteDirection[]
}

export interface RouteStopsData {
  routes: TransitRoute[]
}

export type ForecastConfidence = 'high' | 'medium' | 'low'

export interface HistoricalForecast {
  stopId: string
  routeId: string
  minMinutes: number
  maxMinutes: number
  confidence: ForecastConfidence
  sampleSize: number
}

export interface HistoricalArrivalsData {
  generatedAt: string
  forecasts: HistoricalForecast[]
}

export interface StopForecast extends HistoricalForecast {
  route: TransitRoute
}

export interface ActiveRide {
  routeId: string
  directionId: string
  nextStopIndex: number
  startedAt: string
}
