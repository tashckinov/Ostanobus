import { describe, expect, it } from 'vitest'

import { markerScaleForZoom } from './map-scale'

describe('map marker scale', () => {
  it('reduces bus markers in steps when the map is zoomed out', () => {
    expect(markerScaleForZoom(11)).toBe(0.55)
    expect(markerScaleForZoom(12.5)).toBe(0.7)
    expect(markerScaleForZoom(14)).toBe(0.85)
    expect(markerScaleForZoom(15.5)).toBe(1)
  })
})
