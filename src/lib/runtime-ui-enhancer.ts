import type { Pinia } from 'pinia'

import { initStopActionsEnhancer } from '@/lib/stop-actions-enhancer'
import { useFavoritesStore } from '@/stores/favorites'
import { useTransitStore } from '@/stores/transit'

function iconStar(filled: boolean) {
  return `<svg viewBox="0 0 24 24" width="21" height="21" ${filled ? 'fill="currentColor"' : 'fill="none"'} stroke="currentColor" stroke-width="2"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2L5.8 21 7 14.2l-5-4.9 6.9-1L12 2Z"/></svg>`
}

export function initRuntimeUiEnhancer(pinia: Pinia) {
  const transit = useTransitStore(pinia)
  const favorites = useFavoritesStore(pinia)
  const disposeStopActions = initStopActionsEnhancer(transit, favorites)

  function closeVehicleMenu() {
    document.querySelector('[data-vehicle-menu-overlay]')?.remove()
  }

  function openVehicleMenu(routeNumber: string) {
    closeVehicleMenu()
    const route = transit.routeStops.routes.find((item) => item.number === routeNumber)
    if (!route) return

    const overlay = document.createElement('div')
    overlay.dataset.vehicleMenuOverlay = 'true'
    overlay.className = 'fixed inset-0 z-[80] flex items-end bg-black/35'
    overlay.onclick = (event) => {
      if (event.target === overlay) closeVehicleMenu()
    }

    const panel = document.createElement('div')
    panel.className = 'safe-bottom w-full rounded-t-md border-t border-border bg-background p-4 shadow-xl'
    panel.innerHTML = `
      <div class="flex items-center justify-between gap-3 border-b border-border pb-3">
        <div><p class="font-semibold">Автобус № ${route.number}</p><p class="text-xs text-muted-foreground">${route.directions[0]?.name ?? 'Маршрут автобуса'}</p></div>
        <button type="button" data-favorite-route class="grid size-10 place-items-center text-muted-foreground" aria-label="Добавить маршрут в избранное">${iconStar(favorites.routeSet.has(route.routeId))}</button>
      </div>
      <button type="button" data-show-route class="mt-3 flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Показать маршрут автобуса</button>
      <button type="button" data-close-vehicle class="mt-2 min-h-10 w-full text-sm text-muted-foreground">Закрыть</button>
    `
    overlay.appendChild(panel)
    document.body.appendChild(overlay)

    panel.querySelector<HTMLButtonElement>('[data-favorite-route]')!.onclick = (event) => {
      event.stopPropagation()
      favorites.toggleRoute(route.routeId)
      const button = event.currentTarget as HTMLButtonElement
      button.innerHTML = iconStar(favorites.routeSet.has(route.routeId))
    }
    panel.querySelector<HTMLButtonElement>('[data-show-route]')!.onclick = () => {
      const direction = route.directions[0]
      if (direction) {
        transit.selectStop(null)
        transit.selectRoute(`${route.routeId}::${direction.id}`)
      }
      closeVehicleMenu()
    }
    panel.querySelector<HTMLButtonElement>('[data-close-vehicle]')!.onclick = closeVehicleMenu
  }

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target as HTMLElement
      const marker = target.closest<HTMLElement>('.bus-badge-container')
      if (!marker) return
      const label = marker.getAttribute('aria-label') ?? ''
      const routeNumber = label.replace(/^Автобус\s+/, '').trim()
      if (routeNumber) window.setTimeout(() => openVehicleMenu(routeNumber), 0)
    },
    true,
  )

  function enhanceDrawer() {
    const drawer = document.querySelector<HTMLElement>('aside[role="dialog"]')
    if (!drawer) return
    for (const button of drawer.querySelectorAll<HTMLButtonElement>('nav button')) {
      const text = button.textContent?.trim() ?? ''
      if (text.includes('История поездок') || text.includes('Мои отметки')) button.remove()
    }

    const favoriteButton = Array.from(drawer.querySelectorAll<HTMLButtonElement>('nav button')).find((button) =>
      button.textContent?.includes('Избранные остановки'),
    )
    if (favoriteButton) {
      const label = favoriteButton.querySelector('span')
      if (label) label.textContent = 'Избранное'
    }

    const heading = drawer.querySelector('h1')
    if (heading?.textContent?.trim() !== 'Избранные остановки') return
    heading.textContent = 'Избранное'
    const content = drawer.querySelector<HTMLElement>('.min-h-0.flex-1.overflow-y-auto > div:last-child')
    if (!content || content.dataset.favoritesRendered === 'true') return
    content.dataset.favoritesRendered = 'true'
    content.className = 'divide-y divide-border'

    const routeItems = favorites.routeIds
      .map((id) => transit.routeStops.routes.find((route) => route.routeId === id))
      .filter(Boolean)
    const stopItems = favorites.stopIds
      .map((id) => transit.stopsById.get(id))
      .filter(Boolean)

    content.innerHTML = `
      <div class="px-4 py-3 text-xs font-semibold text-muted-foreground">МАРШРУТЫ</div>
      ${routeItems.length ? routeItems.map((route) => `<button type="button" data-favorite-route-open="${route!.routeId}" class="flex min-h-12 w-full items-center gap-3 px-4 text-left hover:bg-muted"><span class="font-semibold">№ ${route!.number}</span><span class="truncate text-sm">${route!.directions[0]?.name ?? 'Маршрут'}</span></button>`).join('') : '<p class="px-4 py-3 text-sm text-muted-foreground">Нет избранных маршрутов.</p>'}
      <div class="px-4 py-3 text-xs font-semibold text-muted-foreground">ОСТАНОВКИ</div>
      ${stopItems.length ? stopItems.map((stop) => `<button type="button" data-favorite-stop-open="${stop!.properties.id}" class="flex min-h-12 w-full items-center px-4 text-left text-sm hover:bg-muted">${stop!.properties.name}</button>`).join('') : '<p class="px-4 py-3 text-sm text-muted-foreground">Нет избранных остановок.</p>'}
    `

    content.querySelectorAll<HTMLButtonElement>('[data-favorite-route-open]').forEach((button) => {
      button.onclick = () => {
        const route = transit.routeStops.routes.find((item) => item.routeId === button.dataset.favoriteRouteOpen)
        const direction = route?.directions[0]
        if (route && direction) transit.selectRoute(`${route.routeId}::${direction.id}`)
      }
    })
    content.querySelectorAll<HTMLButtonElement>('[data-favorite-stop-open]').forEach((button) => {
      button.onclick = () => transit.selectStop(button.dataset.favoriteStopOpen ?? null)
    })
  }

  const drawerObserver = new MutationObserver(enhanceDrawer)
  drawerObserver.observe(document.body, { childList: true, subtree: true })
  enhanceDrawer()

  return () => {
    disposeStopActions()
    drawerObserver.disconnect()
    closeVehicleMenu()
  }
}
