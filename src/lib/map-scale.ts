export function markerScaleForZoom(zoom: number) {
  if (zoom < 12.5) return 0.55
  if (zoom < 14) return 0.7
  if (zoom < 15.5) return 0.85
  return 1
}
