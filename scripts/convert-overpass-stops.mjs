import { readFile, writeFile } from 'node:fs/promises'

const [inputPath, outputPath] = process.argv.slice(2)

if (!inputPath || !outputPath) {
  throw new Error('Usage: node scripts/convert-overpass-stops.mjs input.json output.geojson')
}

const overpass = JSON.parse(await readFile(inputPath, 'utf8'))
const seen = new Set()

const features = overpass.elements
  .filter((element) => {
    if (element.type !== 'node' || !element.tags?.name) return false
    const isBusStop = element.tags.highway === 'bus_stop'
    const isBusPlatform = element.tags.public_transport === 'platform' && element.tags.bus === 'yes'
    return isBusStop || isBusPlatform
  })
  .filter((element) => {
    if (seen.has(element.id)) return false
    seen.add(element.id)
    return true
  })
  .sort((left, right) => left.tags.name.localeCompare(right.tags.name, 'ru') || left.id - right.id)
  .map((element) => ({
    type: 'Feature',
    id: `osm-node-${element.id}`,
    properties: {
      id: `osm-node-${element.id}`,
      name: element.tags.name,
      shortName: element.tags.name,
      osmId: element.id,
      osmUrl: `https://www.openstreetmap.org/node/${element.id}`,
      shelter: element.tags.shelter ?? null,
      bench: element.tags.bench ?? null,
      bus: element.tags.bus ?? null,
      trolleybus: element.tags.trolleybus ?? null,
    },
    geometry: {
      type: 'Point',
      coordinates: [element.lon, element.lat],
    },
  }))

const geojson = {
  type: 'FeatureCollection',
  source: {
    name: 'OpenStreetMap',
    license: 'ODbL 1.0',
    relation: 966497,
    retrievedAt: '2026-07-25',
    overpassQuery:
      'area(3600966497); (node["highway"="bus_stop"](area); node["public_transport"="platform"]["bus"="yes"](area);); out body;',
  },
  features,
}

await writeFile(outputPath, `${JSON.stringify(geojson, null, 2)}\n`)
console.log(`Written ${features.length} stops to ${outputPath}`)
