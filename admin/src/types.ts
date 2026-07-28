export interface Stop {
  id: string
  cityId: string
  name: string
  shortName: string
  longitude: number
  latitude: number
  osmId: string | null
  osmUrl: string | null
  active: boolean
}

export interface RoadAnchor {
  stopId: string
  longitude: number
  latitude: number
}

export interface RouteSegment {
  id: string
  fromStopId: string
  toStopId: string
  mode: 'automatic' | 'manual'
  status: 'draft' | 'fixed' | 'error'
  viaPoints: Array<{ longitude: number; latitude: number }>
  geometry: GeoJSON.LineString | null
  distanceMeters: number | null
}

export interface Direction {
  id: string
  name: string
  terminal: string
  stopIds: string[]
  roadAnchors: RoadAnchor[]
  routeType: 'linear' | 'circular'
  segments: RouteSegment[]
  active: boolean
}

export interface Route {
  routeId: string
  cityId: string
  number: string
  name: string | null
  color: string
  active: boolean
  isMock: boolean
  directions: Direction[]
}

export interface Schedule {
  id?: string
  directionId: string
  stopId: string | null
  days: number[]
  type: 'exact' | 'interval'
  departureTime: string | null
  startTime: string | null
  endTime: string | null
  headwayMinutes: number | null
  active: boolean
}

export interface Forecast {
  id?: string
  stopId: string
  routeId: string
  directionId: string | null
  minMinutes: number
  maxMinutes: number
  confidence: 'high' | 'medium' | 'low'
  sampleSize: number
  active: boolean
  calculatedAt?: string
}
