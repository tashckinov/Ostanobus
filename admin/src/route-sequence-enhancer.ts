import { api } from './api'
import type { Direction, Route, Schedule, Stop } from './types'

const CACHE_LIFETIME_MS = 30_000

let routes: Route[] = []
let stops: Stop[] = []
let dataLoadedAt = 0
let scheduled = false
let enhancing = false
let observer: MutationObserver | null = null
const scheduleCache = new Map<string, { loadedAt: number; schedules: Schedule[] }>()

function parseTime(value: string | null) {
  if (!value) return null
  const [hours, minutes] = value.split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  return (hours ?? 0) * 60 + (minutes ?? 0)
}

function positiveDifference(from: number, to: number) {
  let difference = to - from
  if (difference < -720) difference += 1440
  return difference > 0 && difference <= 180 ? difference : null
}

function median(values: number[]) {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2
}

function overlappingDays(left: Schedule, right: Schedule) {
  return left.days.some((day) => right.days.includes(day))
}

function estimateTravelMinutes(schedules: Schedule[], fromStopId: string, toStopId: string) {
  const active = schedules.filter((schedule) => schedule.active !== false)
  const fromExact = active.filter(
    (schedule) => schedule.stopId === fromStopId && schedule.type === 'exact',
  )
  const toExact = active.filter(
    (schedule) => schedule.stopId === toStopId && schedule.type === 'exact',
  )
  const exactDifferences: number[] = []

  for (const day of [1, 2, 3, 4, 5, 6, 7]) {
    const fromTimes = fromExact
      .filter((schedule) => schedule.days.includes(day))
      .map((schedule) => parseTime(schedule.departureTime))
      .filter((time): time is number => time !== null)
      .sort((left, right) => left - right)
    const toTimes = toExact
      .filter((schedule) => schedule.days.includes(day))
      .map((schedule) => parseTime(schedule.departureTime))
      .filter((time): time is number => time !== null)
      .sort((left, right) => left - right)

    for (let index = 0; index < Math.min(fromTimes.length, toTimes.length); index += 1) {
      const difference = positiveDifference(fromTimes[index]!, toTimes[index]!)
      if (difference !== null) exactDifferences.push(difference)
    }
  }

  const exactMedian = median(exactDifferences)
  if (exactMedian !== null) return exactMedian

  const fromIntervals = active.filter(
    (schedule) => schedule.stopId === fromStopId && schedule.type === 'interval',
  )
  const toIntervals = active.filter(
    (schedule) => schedule.stopId === toStopId && schedule.type === 'interval',
  )
  const intervalDifferences: number[] = []

  for (const from of fromIntervals) {
    for (const to of toIntervals) {
      if (!overlappingDays(from, to)) continue
      if (
        from.headwayMinutes &&
        to.headwayMinutes &&
        from.headwayMinutes !== to.headwayMinutes
      ) {
        continue
      }
      const fromStart = parseTime(from.startTime)
      const toStart = parseTime(to.startTime)
      if (fromStart === null || toStart === null) continue
      const difference = positiveDifference(fromStart, toStart)
      if (difference !== null) intervalDifferences.push(difference)
    }
  }

  return median(intervalDifferences)
}

async function ensureReferenceData(force = false) {
  if (!force && routes.length && stops.length && Date.now() - dataLoadedAt < CACHE_LIFETIME_MS) {
    return
  }
  ;[routes, stops] = await Promise.all([api.routes(), api.stops()])
  dataLoadedAt = Date.now()
}

function currentDirection(): Direction | null {
  const routeHeading = document.querySelector<HTMLElement>('.route-back-heading strong')
  const routeNumber = routeHeading?.textContent?.match(/№\s*(.+)$/)?.[1]?.trim()
  if (!routeNumber) return null

  const route = routes.find((candidate) => candidate.number.trim() === routeNumber)
  if (!route) return null

  const tabs = Array.from(document.querySelectorAll<HTMLElement>('.direction-tab'))
  const directionIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.classList.contains('active')),
  )
  return route.directions[directionIndex] ?? null
}

async function directionSchedules(directionId: string) {
  const cached = scheduleCache.get(directionId)
  if (cached && Date.now() - cached.loadedAt < CACHE_LIFETIME_MS) return cached.schedules
  const schedules = await api.schedules(directionId)
  scheduleCache.set(directionId, { loadedAt: Date.now(), schedules })
  return schedules
}

function visibleStopIds(stopList: HTMLOListElement, direction: Direction) {
  const stopByName = new Map(stops.map((stop) => [stop.name.trim(), stop.id]))
  return Array.from(stopList.querySelectorAll<HTMLElement>(':scope > li')).map((item, index) => {
    const name = item.querySelector('strong')?.textContent?.trim()
    return (name ? stopByName.get(name) : null) ?? direction.stopIds[index] ?? ''
  })
}

function collectSegmentButtons(panel: HTMLElement, stopList: HTMLOListElement) {
  const originalList = panel.querySelector<HTMLElement>('.segment-list')
  const buttons = [
    ...Array.from(originalList?.querySelectorAll<HTMLButtonElement>(':scope > button') ?? []),
    ...Array.from(
      stopList.querySelectorAll<HTMLButtonElement>(':scope > button.combined-segment-row'),
    ),
  ]

  for (let index = 0; index < buttons.length; index += 1) {
    if (!buttons[index]!.dataset.segmentIndex) {
      buttons[index]!.dataset.segmentIndex = String(index)
    }
  }

  return [...new Set(buttons)].sort(
    (left, right) => Number(left.dataset.segmentIndex) - Number(right.dataset.segmentIndex),
  )
}

async function updateTravelTimes(
  stopList: HTMLOListElement,
  buttons: HTMLButtonElement[],
  direction: Direction,
) {
  const schedules = await directionSchedules(direction.id)
  const stopIds = visibleStopIds(stopList, direction)

  buttons.forEach((button, index) => {
    const fromStopId = stopIds[index]
    const toStopId = stopIds[index + 1] ?? (direction.routeType === 'circular' ? stopIds[0] : null)
    const duration =
      fromStopId && toStopId ? estimateTravelMinutes(schedules, fromStopId, toStopId) : null
    const text =
      duration === null
        ? 'Время не рассчитано'
        : `≈ ${Math.max(1, Math.round(duration))} мин в пути`
    let label = button.querySelector<HTMLElement>('.segment-travel-time')
    if (!label) {
      label = document.createElement('small')
      label.className = 'segment-travel-time'
      button.appendChild(label)
    }
    if (label.textContent !== text) label.textContent = text
  })
}

async function enhance() {
  if (enhancing) return
  enhancing = true
  try {
    await ensureReferenceData()
    const panel = document.querySelector<HTMLElement>(
      '.segment-editor-panel:not(.route-schedule-panel)',
    )
    if (!panel) return
    const stopList = panel.querySelector<HTMLOListElement>('ol.route-waypoints')
    const segmentList = panel.querySelector<HTMLElement>('.segment-list')
    if (!stopList || !segmentList) return

    const direction = currentDirection()
    if (!direction) return

    panel.classList.add('combined-sequence-panel')
    stopList.classList.add('combined-route-sequence')
    segmentList.classList.add('combined-source-segments')
    panel.querySelector('.stops-order-heading')?.classList.add('combined-hidden-heading')

    const heading = panel.querySelector<HTMLElement>('.route-order-heading strong')
    if (heading && heading.textContent !== 'Остановки и отрезки') {
      heading.textContent = 'Остановки и отрезки'
    }

    const stopItems = Array.from(stopList.querySelectorAll<HTMLElement>(':scope > li'))
    const buttons = collectSegmentButtons(panel, stopList)
    buttons.forEach((button, index) => {
      button.classList.add('combined-segment-row')
      const stopItem = stopItems[index]
      if (stopItem && stopItem.nextElementSibling !== button) stopItem.after(button)
      else if (!stopItem && button.parentElement !== stopList) stopList.appendChild(button)
    })

    void updateTravelTimes(stopList, buttons, direction)
  } catch (error) {
    console.error('Не удалось объединить остановки и сегменты', error)
  } finally {
    enhancing = false
  }
}

function scheduleEnhancement() {
  if (scheduled) return
  scheduled = true
  requestAnimationFrame(() => {
    scheduled = false
    void enhance()
  })
}

export function initRouteSequenceEnhancer() {
  if (observer) return
  observer = new MutationObserver(scheduleEnhancement)
  observer.observe(document.body, { childList: true, subtree: true })

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    if (
      target.closest('.route-schedule-form button[type="submit"]') ||
      target.closest('.schedule-record .text-danger') ||
      target.closest('.route-actions button')
    ) {
      scheduleCache.clear()
      window.setTimeout(() => {
        void ensureReferenceData(true).finally(scheduleEnhancement)
      }, 700)
    }
  })

  scheduleEnhancement()
}
