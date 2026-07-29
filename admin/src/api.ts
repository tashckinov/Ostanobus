import type { Forecast, Route, Schedule, Stop } from './types'

const tokenKey = 'ostanobus-admin-token'

export function getToken() {
  return sessionStorage.getItem(tokenKey)
}

export function setToken(token: string | null) {
  if (token) sessionStorage.setItem(tokenKey, token)
  else sessionStorage.removeItem(tokenKey)
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken()
  const response = await fetch(path, {
    ...init,
    cache: init.cache ?? 'no-store',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })
  if (response.status === 401) {
    setToken(null)
    window.dispatchEvent(new Event('admin-unauthorized'))
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(payload?.error ?? `HTTP ${response.status}`)
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
}

export async function login(email: string, password: string) {
  const result = await request<{ token: string }>('/api/admin/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  setToken(result.token)
}

export const api = {
  dashboard: () =>
    request<{
      cities: number
      stops: number
      routes: number
      events: number
      newTickets: number
    }>('/api/admin/dashboard'),

  stops: async () => {
    const data = await request<GeoJSON.FeatureCollection<GeoJSON.Point>>(
      '/api/admin/stops?cityId=volgodonsk',
    )
    return data.features.map((feature) => {
      const properties = feature.properties as Omit<Stop, 'longitude' | 'latitude'>
      return {
        ...properties,
        longitude: feature.geometry.coordinates[0]!,
        latitude: feature.geometry.coordinates[1]!,
      }
    })
  },
  saveStop: (stop: Partial<Stop>) =>
    request<Stop>(stop.id ? `/api/admin/stops/${stop.id}` : '/api/admin/stops', {
      method: stop.id ? 'PUT' : 'POST',
      body: JSON.stringify(stop),
    }),
  deleteStop: (id: string) => request<void>(`/api/admin/stops/${id}`, { method: 'DELETE' }),

  routes: () =>
    request<{ routes: Route[] }>('/api/admin/routes?cityId=volgodonsk').then(
      (result) => result.routes,
    ),
  saveRoute: (route: Route) =>
    request<{ routeId: string }>('/api/admin/routes', {
      method: 'POST',
      body: JSON.stringify(route),
    }),
  deleteRoute: (id: string) => request<void>(`/api/admin/routes/${id}`, { method: 'DELETE' }),
  buildGeometry: (coordinates: number[][]) =>
    request<{ distanceMeters: number; geometry: GeoJSON.LineString }>('/api/admin/routing/route', {
      method: 'POST',
      body: JSON.stringify({ coordinates }),
    }),
  buildSegmentGeometry: (from: number[], to: number[], via: number[][]) =>
    request<{ distanceMeters: number; geometry: GeoJSON.LineString }>(
      '/api/admin/routing/segment',
      {
        method: 'POST',
        body: JSON.stringify({ from, to, via }),
      },
    ),

  schedules: (directionId?: string, stopId?: string) => {
    const query = new URLSearchParams()
    if (directionId) query.set('directionId', directionId)
    if (stopId) query.set('stopId', stopId)
    const suffix = query.size ? `?${query.toString()}` : ''
    return request<{ schedules: Schedule[] }>(`/api/admin/schedules${suffix}`).then(
      (result) => result.schedules,
    )
  },
  saveSchedule: (schedule: Schedule) =>
    request<Schedule>('/api/admin/schedules', {
      method: 'POST',
      body: JSON.stringify(schedule),
    }),
  deleteSchedule: (id: string) => request<void>(`/api/admin/schedules/${id}`, { method: 'DELETE' }),

  forecasts: () =>
    request<{ forecasts: Forecast[] }>('/api/admin/forecasts').then((result) => result.forecasts),
  saveForecast: (forecast: Forecast) =>
    request<Forecast>('/api/admin/forecasts', {
      method: 'POST',
      body: JSON.stringify(forecast),
    }),
  deleteForecast: (id: string) => request<void>(`/api/admin/forecasts/${id}`, { method: 'DELETE' }),

  events: () =>
    request<{ events: Array<Record<string, string>> }>('/api/admin/events').then(
      (result) => result.events,
    ),
  addEvent: (event: { type: string; routeId: string; stopId: string; time: string }) =>
    request<Record<string, string>>('/api/admin/events', {
      method: 'POST',
      body: JSON.stringify(event),
    }),
  deleteEvent: (id: string) => request<void>(`/api/admin/events/${id}`, { method: 'DELETE' }),
  tickets: () =>
    request<{ tickets: Array<Record<string, string | null>> }>('/api/admin/support/tickets').then(
      (result) => result.tickets,
    ),
  updateTicket: (id: string, status: string, adminReply: string | null) =>
    request(`/api/admin/support/tickets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, adminReply }),
    }),
}
