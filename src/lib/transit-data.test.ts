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

  it('publishes only the declared test route and JSON forecasts', async () => {
    const stops = await readJson('stops.geojson')
    const routeStops = await readJson('route-stops.json')
    const forecasts = await readJson('mock-forecasts.json')
    const stopNames = new Map(
      stops.features.map(
        (feature: { properties: { id: string; name: string } }) =>
          [feature.properties.id, feature.properties.name] as const,
      ),
    )
    const direction = routeStops.routes[0].directions[0]

    expect(routeStops.routes).toHaveLength(1)
    expect(routeStops.routes[0].number).toBe('3К')
    expect(direction.stopIds.map((stopId: string) => stopNames.get(stopId))).toEqual([
      'ВЗМЭО',
      'Индустриальная улица',
      'Квартал В-У',
      'Октябрьский микрорайон',
      'Квартал В-15',
      'Квартал В-14',
      'Квартал В-8',
      'Квартал В-9',
      'Лазоревый проспект',
      'Магазин Артемида',
    ])
    expect(forecasts.isMock).toBe(true)
    expect(forecasts.forecasts).toHaveLength(10)
    expect(
      forecasts.forecasts.every((forecast: { stopId: string }) =>
        direction.stopIds.includes(forecast.stopId),
      ),
    ).toBe(true)
  })
})
