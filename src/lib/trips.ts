import type { RouteDirection } from '@/types/transit'

export interface ActiveTrip {
  id: string
  times: number[]
}

export function parseTime(value: string | null) {
  if (!value) return null
  const [hours, minutes] = value.split(':').map(Number)
  if (hours === undefined || minutes === undefined) return null
  return hours * 60 + minutes
}

export function interpolateMissingTimes(tripStopTimes: (number | null)[]) {
  for (let i = 0; i < tripStopTimes.length; i++) {
    if (tripStopTimes[i] === null) {
      let prevIdx = i - 1
      while (prevIdx >= 0 && tripStopTimes[prevIdx] === null) prevIdx--
      let nextIdx = i + 1
      while (nextIdx < tripStopTimes.length && tripStopTimes[nextIdx] === null) nextIdx++

      if (prevIdx >= 0 && nextIdx < tripStopTimes.length) {
        const prevTime = tripStopTimes[prevIdx]!
        let nextTime = tripStopTimes[nextIdx]!
        
        if (nextTime < prevTime && prevTime - nextTime > 720) {
          nextTime += 1440
        }

        const fraction = (i - prevIdx) / (nextIdx - prevIdx)
        tripStopTimes[i] = prevTime + fraction * (nextTime - prevTime)
      } else if (prevIdx >= 0) {
        tripStopTimes[i] = tripStopTimes[prevIdx]! + 1
      } else if (nextIdx < tripStopTimes.length) {
        tripStopTimes[i] = tripStopTimes[nextIdx]! - 1
      } else {
        tripStopTimes[i] = 0
      }
    }
  }
}

export function buildTrips(routeId: string, direction: RouteDirection, weekday: number): ActiveTrip[] {
  const baseTrips: number[][] = []
  if (!direction.schedules || !direction.schedules.length) return []

  const daily = direction.schedules.filter((s) => s.days.includes(weekday))
  if (!daily.length) return []

  const intervalSchedules = daily.filter((s) => s.type === 'interval')
  if (intervalSchedules.length > 0) {
    let baseSch = intervalSchedules.find(
      (s) => s.stopId && s.startTime && s.endTime && s.headwayMinutes,
    )
    if (!baseSch) baseSch = intervalSchedules[0]
    
    if (baseSch && baseSch.headwayMinutes && baseSch.startTime && baseSch.endTime) {
      const startTime = parseTime(baseSch.startTime)
      let endTime = parseTime(baseSch.endTime)
      if (startTime !== null && endTime !== null) {
        if (endTime < startTime) endTime += 1440

        const headway = baseSch.headwayMinutes
        const numTrips = Math.floor((endTime - startTime) / headway) + 1

        for (let k = 0; k < numTrips; k++) {
          const tripStopTimes: (number | null)[] = []
          for (const stopId of direction.stopIds) {
            const sch = intervalSchedules.find((s) => s.stopId === stopId)
            if (sch && sch.startTime) {
              const st = parseTime(sch.startTime)
              if (st !== null) {
                tripStopTimes.push(st + k * headway)
                continue
              }
            }
            tripStopTimes.push(null)
          }

          interpolateMissingTimes(tripStopTimes)
          baseTrips.push(tripStopTimes as number[])
        }
      }
    }
  } else {
    // Exact schedules
    const exactSchedules = daily.filter((s) => s.type === 'exact')
    if (exactSchedules.length > 0) {
      const byStop = new Map<string, number[]>()
      for (const sch of exactSchedules) {
        if (!sch.stopId || !sch.departureTime) continue
        const t = parseTime(sch.departureTime)
        if (t !== null) {
          if (!byStop.has(sch.stopId)) byStop.set(sch.stopId, [])
          byStop.get(sch.stopId)!.push(t)
        }
      }

      for (const times of byStop.values()) {
        times.sort((a, b) => a - b)
      }

      let numTrips = 0
      for (const stopId of direction.stopIds) {
        const times = byStop.get(stopId)
        if (times && times.length > numTrips) numTrips = times.length
      }

      for (let k = 0; k < numTrips; k++) {
        const tripStopTimes: (number | null)[] = []
        for (const stopId of direction.stopIds) {
          const times = byStop.get(stopId)
          if (times && k < times.length) {
            let t = times[k]!
            // Adjust for midnight crossing in exact schedules if needed
            if (tripStopTimes.length > 0) {
               const prevTime = tripStopTimes[tripStopTimes.length - 1]
               if (prevTime !== null && t < prevTime && prevTime - t > 720) t += 1440
            }
            tripStopTimes.push(t)
          } else {
            tripStopTimes.push(null)
          }
        }
        interpolateMissingTimes(tripStopTimes)
        baseTrips.push(tripStopTimes as number[])
      }
    }
  }

  // Cross-day trips replication
  const allTrips: ActiveTrip[] = []
  for (let i = 0; i < baseTrips.length; i++) {
    const trip = baseTrips[i]!
    allTrips.push({ id: `${routeId}::${direction.id}-trip-${i}-base`, times: trip })
    allTrips.push({ id: `${routeId}::${direction.id}-trip-${i}-prev`, times: trip.map((t) => t - 1440) })
    allTrips.push({ id: `${routeId}::${direction.id}-trip-${i}-next`, times: trip.map((t) => t + 1440) })
  }
  return allTrips
}
