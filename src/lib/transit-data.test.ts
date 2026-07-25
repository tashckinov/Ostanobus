import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

async function readJson(relativePath: string) {
  const url = new URL(`../../public/data/${relativePath}`, import.meta.url)
  return JSON.parse(await readFile(url, 'utf8'))
}

describe('published transit data', () => {
  it('contains named OpenStreetMap stops with unique node ids', async () => {
    const stops = await readJson('stops.geojson')
    const ids = stops.features.map(
      (feature: { properties: { id: string } }) => feature.properties.id,
    )

    expect(stops.source.name).toBe('OpenStreetMap')
    expect(stops.features.length).toBeGreaterThan(250)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id: string) => id.startsWith('osm-node-'))).toBe(true)
  })

  it('does not publish unverified routes or forecasts', async () => {
    const routes = await readJson('routes.geojson')
    const routeStops = await readJson('route-stops.json')
    const historicalArrivals = await readJson('historical-arrivals.json')

    expect(routes.features).toEqual([])
    expect(routeStops.routes).toEqual([])
    expect(historicalArrivals.forecasts).toEqual([])
  })
})
