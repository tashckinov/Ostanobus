import type {
  Forecast,
  RouteDirection,
  RouteSchedule,
  StopForecast,
  TransitRoute,
  VehicleInstance,
} from '@/types/transit'
import { buildTrips, parseTime } from './trips'

const DAY_MINUTES = 24 * 60
const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000
export const CITY_TIME_ZONE = 'Europe/Moscow'
const shortDayNames = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

export interface ScheduledArrival {
  time: string
  minutesUntil: number
  dayOffset: number
  timeLabel: string
  relativeLabel: string
}

export interface StopService {
  route: TransitRoute
  direction: RouteDirection
  schedules: RouteSchedule[]
  scheduleLabels: string[]
  nextArrival: ScheduledArrival | null
  forecast?: StopForecast
  vehicle?: VehicleInstance
  tripId?: string
}

function zonedDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CITY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value)
  const year = value('year')
  const month = value('month')
  const day = value('day')
  const hours = value('hour')
  const minutes = value('minute')
  const jsWeekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()

  return {
    year,
    month,
    day,
    weekday: jsWeekday === 0 ? 7 : jsWeekday,
    jsWeekday,
    minutes: hours * 60 + minutes,
  }
}

export function serviceDateString(date: Date) {
  const parts = zonedDateParts(date)
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

export function observedVehicleInstanceId(routeId: string, directionId: string, now = new Date()) {
  const parts = zonedDateParts(now)
  const hours = String(Math.floor(parts.minutes / 60)).padStart(2, '0')
  const minutes = String(parts.minutes % 60).padStart(2, '0')
  return `${serviceDateString(now)}::${routeId}::${directionId}::observed-${hours}:${minutes}`
}

export function scheduledArrivalIso(arrival: ScheduledArrival, now = new Date()) {
  const serviceDay = new Date(now.getTime() + arrival.dayOffset * DAY_MILLISECONDS)
  const parts = zonedDateParts(serviceDay)
  const [hours = 0, minutes = 0] = arrival.time.split(':').map(Number)
  // Europe/Moscow has been fixed at UTC+3 since 2014.
  return new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, hours - 3, minutes),
  ).toISOString()
}

function candidateForSchedule(schedule: RouteSchedule, currentMinutes: number, dayOffset: number) {
  if (schedule.type === 'exact') {
    const departure = parseTime(schedule.departureTime)
    if (departure === null || (dayOffset === 0 && departure < currentMinutes)) return null
    return departure
  }

  const start = parseTime(schedule.startTime)
  const end = parseTime(schedule.endTime)
  const headway = schedule.headwayMinutes
  if (start === null || end === null || !headway || headway < 1) return null
  if (dayOffset > 0 || currentMinutes <= start) return start

  const candidate = start + Math.ceil((currentMinutes - start) / headway) * headway
  return candidate <= end ? candidate : null
}

function relativeTimeLabel(minutes: number) {
  if (minutes < 1) return 'сейчас'
  if (minutes < 60) return `через ${minutes} мин`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes ? `через ${hours} ч ${remainingMinutes} мин` : `через ${hours} ч`
}

export function nextScheduledArrival(
  schedules: RouteSchedule[],
  now = new Date(),
): ScheduledArrival | null {
  const current = zonedDateParts(now)
  let nearest:
    | {
        time: string
        minutesUntil: number
        dayOffset: number
        jsWeekday: number
      }
    | undefined

  for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
    const day = zonedDateParts(new Date(now.getTime() + dayOffset * DAY_MILLISECONDS))
    for (const schedule of schedules) {
      if (!schedule.days.includes(day.weekday)) continue
      const candidate = candidateForSchedule(schedule, current.minutes, dayOffset)
      if (candidate === null) continue
      const minutesUntil = dayOffset * DAY_MINUTES + candidate - current.minutes
      if (minutesUntil < 0 || (nearest && nearest.minutesUntil <= minutesUntil)) continue
      const hours = Math.floor(candidate / 60)
      const minutes = candidate % 60
      nearest = {
        time: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
        minutesUntil,
        dayOffset,
        jsWeekday: day.jsWeekday,
      }
    }
    if (nearest) break
  }

  if (!nearest) return null
  const dayPrefix =
    nearest.dayOffset === 0
      ? ''
      : nearest.dayOffset === 1
        ? 'завтра, '
        : `${shortDayNames[nearest.jsWeekday]}, `
  return {
    time: nearest.time,
    minutesUntil: nearest.minutesUntil,
    dayOffset: nearest.dayOffset,
    timeLabel: `${dayPrefix}${nearest.time}`,
    relativeLabel: relativeTimeLabel(nearest.minutesUntil),
  }
}

export function scheduleLabelsForToday(schedules: RouteSchedule[], now = new Date()) {
  const weekday = zonedDateParts(now).weekday
  const today = schedules.filter((schedule) => schedule.days.includes(weekday))
  const labels = today.map((schedule) => {
    if (schedule.type === 'exact')
      return schedule.departureTime ? `В ${schedule.departureTime}` : ''
    if (!schedule.startTime || !schedule.endTime || !schedule.headwayMinutes) return ''
    return `${schedule.startTime}–${schedule.endTime} · каждые ${schedule.headwayMinutes} мин`
  })
  return [...new Set(labels.filter(Boolean))]
}

export function servicesForStop(
  stopId: string,
  routes: TransitRoute[],
  forecasts: Forecast[],
  vehicles: VehicleInstance[] = [],
  now = new Date(),
): StopService[] {
  const services = routes.flatMap((route) =>
    route.directions
      .filter((direction) => direction.stopIds.includes(stopId))
      .map((direction) => {
        const schedules = (direction.schedules ?? []).filter(
          (schedule) => schedule.stopId === stopId || schedule.stopId === null,
        )
        const forecast = forecasts.find(
          (item) =>
            item.stopId === stopId &&
            item.routeId === route.routeId &&
            (!item.directionId || item.directionId === direction.id),
        )
        const nextArrival = nextScheduledArrival(schedules, now)
        let tripId: string | undefined
        let vehicle: VehicleInstance | undefined

        if (nextArrival) {
          const serviceDate = new Date(now.getTime() + nextArrival.dayOffset * DAY_MILLISECONDS)
          const serviceDateStr = serviceDateString(serviceDate)
          const weekday = zonedDateParts(serviceDate).weekday
          const allTrips = buildTrips(route.routeId, direction, weekday)

          let tripStartTime = nextArrival.time
          const [hh, mm] = nextArrival.time.split(':').map(Number)
          const nextArrivalMinutes = (hh || 0) * 60 + (mm || 0)

          const stopIndex = direction.stopIds.indexOf(stopId)
          if (stopIndex !== -1) {
            // Find a trip that arrives at this stop at the scheduled time (allow small difference due to interpolation)
            const matchingTrip = allTrips.find(
              (t) =>
                t.times[stopIndex] !== null &&
                Math.abs(t.times[stopIndex]! - nextArrivalMinutes) < 3,
            )
            if (matchingTrip && matchingTrip.times[0] !== null) {
              const startTotal = matchingTrip.times[0]
              const startH = Math.floor(startTotal / 60)
              const startM = startTotal % 60
              tripStartTime = `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}`
            }
          }

          tripId = `${serviceDateStr}::${route.routeId}::${direction.id}::${tripStartTime}`
          vehicle = vehicles.find((v) => v.id === tripId)

          if (vehicle && vehicle.delaySeconds) {
            const delayMinutes = Math.round(vehicle.delaySeconds / 60)
            nextArrival.minutesUntil += delayMinutes
            nextArrival.relativeLabel = relativeTimeLabel(nextArrival.minutesUntil)
            // recalculate time string
            const arrTimeParts = nextArrival.time.split(':').map(Number)
            const baseMinutes = (arrTimeParts[0] || 0) * 60 + (arrTimeParts[1] || 0) + delayMinutes
            const totalMinutes = ((baseMinutes % (24 * 60)) + 24 * 60) % (24 * 60)
            const finalHours = Math.floor(totalMinutes / 60)
            const finalMins = totalMinutes % 60
            const newTimeStr = `${String(finalHours).padStart(2, '0')}:${String(finalMins).padStart(2, '0')}`
            const dayPrefix =
              nextArrival.dayOffset === 0
                ? ''
                : nextArrival.dayOffset === 1
                  ? 'завтра, '
                  : 'в другой день, '
            nextArrival.timeLabel = `~${dayPrefix}${newTimeStr}`
          }
        }

        return {
          route,
          direction,
          schedules,
          scheduleLabels: scheduleLabelsForToday(schedules, now),
          nextArrival,
          tripId,
          vehicle,
          ...(forecast ? { forecast: { ...forecast, route } } : {}),
        }
      }),
  )

  return services.sort((left, right) => {
    const leftMinutes =
      left.nextArrival?.minutesUntil ?? left.forecast?.minMinutes ?? Number.POSITIVE_INFINITY
    const rightMinutes =
      right.nextArrival?.minutesUntil ?? right.forecast?.minMinutes ?? Number.POSITIVE_INFINITY
    return leftMinutes - rightMinutes || left.route.number.localeCompare(right.route.number, 'ru')
  })
}
