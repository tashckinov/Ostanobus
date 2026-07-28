import { scheduledArrivalIso, servicesForStop } from '@/lib/schedule'
import type { useFavoritesStore } from '@/stores/favorites'
import type { useTransitStore } from '@/stores/transit'

type TransitStore = ReturnType<typeof useTransitStore>
type FavoritesStore = ReturnType<typeof useFavoritesStore>

let observer: MutationObserver | null = null
let scheduled = false

function eyeIcon() {
  return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>'
}

function starIcon(filled: boolean) {
  return `<svg viewBox="0 0 24 24" width="19" height="19" ${filled ? 'fill="currentColor"' : 'fill="none"'} stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2L5.8 21 7 14.2l-5-4.9 6.9-1L12 2Z"/></svg>`
}

export function initStopActionsEnhancer(transit: TransitStore, favorites: FavoritesStore) {
  if (observer) return () => undefined

  const enhance = () => {
    const stop = transit.selectedStop
    if (!stop) return
    const sheet = document.querySelector<HTMLElement>('section[aria-live="polite"]')
    if (!sheet) return

    const heading = sheet.querySelector<HTMLElement>('h2')
    if (heading && !sheet.querySelector('[data-favorite-stop]')) {
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.favoriteStop = stop.properties.id
      button.className = 'ml-auto grid size-10 shrink-0 place-items-center text-muted-foreground'
      button.setAttribute('aria-label', 'Добавить остановку в избранное')
      button.innerHTML = starIcon(favorites.stopSet.has(stop.properties.id))
      button.onclick = () => {
        favorites.toggleStop(stop.properties.id)
        button.innerHTML = starIcon(favorites.stopSet.has(stop.properties.id))
        button.setAttribute(
          'aria-label',
          favorites.stopSet.has(stop.properties.id)
            ? 'Убрать остановку из избранного'
            : 'Добавить остановку в избранное',
        )
      }
      heading.parentElement?.appendChild(button)
    }

    const services = servicesForStop(
      stop.properties.id,
      transit.routeStops.routes,
      transit.selectedStopForecasts,
      transit.vehicles,
      new Date(),
    )
    const rows = Array.from(sheet.querySelectorAll<HTMLButtonElement>('div > button.min-h-16'))
    rows.forEach((row, index) => {
      if (row.querySelector('[data-observe-bus]')) return
      const service = services[index]
      if (!service) return
      const eye = document.createElement('button')
      eye.type = 'button'
      eye.dataset.observeBus = `${service.route.routeId}::${service.direction.id}`
      eye.className = 'grid size-9 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted'
      eye.setAttribute('aria-label', `Подтвердить автобус ${service.route.number}`)
      eye.innerHTML = eyeIcon()
      eye.onclick = async (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (!service.tripId || !service.nextArrival) {
          window.alert('Для этого рейса пока недостаточно данных для подтверждения.')
          return
        }
        if (!window.confirm('Вы видели этот транспорт на остановке сейчас?')) return
        const accepted = await transit.confirmArrival(
          service.route.routeId,
          service.direction.id,
          stop.properties.id,
          service.tripId,
          scheduledArrivalIso(service.nextArrival, new Date()),
          new Date(),
        )
        window.alert(accepted ? 'Спасибо, транспорт подтверждён.' : 'Не удалось отправить подтверждение.')
      }
      row.appendChild(eye)
    })
  }

  const schedule = () => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      enhance()
    })
  }

  observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true })
  schedule()

  return () => {
    observer?.disconnect()
    observer = null
  }
}
