export const DEFAULT_STOP_DWELL_SECONDS = 8

export type VehicleMotionStatus = 'moving' | 'boarding'

export interface VehicleMotion {
  ratio: number
  status: VehicleMotionStatus
  stopIndex: number
  nextStopIndex: number | null
}

/**
 * Рассчитывает положение транспорта вдоль маршрута.
 *
 * Времена в `stopTimes` считаются временем прибытия. После прибытия транспорт
 * остаётся на остановке на несколько секунд, а затем использует оставшееся
 * время до следующего прибытия для движения по сегменту.
 */
export function vehicleMotionAt(
  stopTimes: number[],
  stopRatios: number[],
  currentMinutes: number,
  dwellSeconds = DEFAULT_STOP_DWELL_SECONDS,
): VehicleMotion | null {
  const count = Math.min(stopTimes.length, stopRatios.length)
  if (count === 0 || currentMinutes < stopTimes[0]!) return null

  const requestedDwellMinutes = Math.max(0, dwellSeconds) / 60

  for (let stopIndex = 0; stopIndex < count; stopIndex += 1) {
    const arrival = stopTimes[stopIndex]!
    const ratio = stopRatios[stopIndex]!
    const isLastStop = stopIndex === count - 1

    if (isLastStop) {
      if (currentMinutes <= arrival + requestedDwellMinutes) {
        return {
          ratio,
          status: 'boarding',
          stopIndex,
          nextStopIndex: null,
        }
      }
      return null
    }

    const nextArrival = stopTimes[stopIndex + 1]!
    const segmentDuration = Math.max(0, nextArrival - arrival)
    // На очень коротком интервале стоянка не должна занять всё время движения.
    const dwellMinutes = Math.min(requestedDwellMinutes, segmentDuration * 0.45)
    const departure = arrival + dwellMinutes

    if (currentMinutes <= departure) {
      return {
        ratio,
        status: 'boarding',
        stopIndex,
        nextStopIndex: stopIndex + 1,
      }
    }

    if (currentMinutes < nextArrival) {
      const movementDuration = nextArrival - departure
      const progress = movementDuration > 0 ? (currentMinutes - departure) / movementDuration : 1
      const nextRatio = stopRatios[stopIndex + 1]!
      return {
        ratio: ratio + Math.max(0, Math.min(1, progress)) * (nextRatio - ratio),
        status: 'moving',
        stopIndex,
        nextStopIndex: stopIndex + 1,
      }
    }
  }

  return null
}
