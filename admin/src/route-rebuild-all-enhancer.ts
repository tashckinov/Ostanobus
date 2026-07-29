let observer: MutationObserver | null = null
let rebuilding = false

function waitFor(predicate: () => boolean, timeoutMs = 30_000) {
  return new Promise<void>((resolve, reject) => {
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      if (predicate()) {
        window.clearInterval(timer)
        resolve()
      } else if (Date.now() - startedAt > timeoutMs) {
        window.clearInterval(timer)
        reject(new Error('Превышено время ожидания построения сегмента'))
      }
    }, 100)
  })
}

async function rebuildAll(button: HTMLButtonElement) {
  if (rebuilding) return
  const panel = button.closest<HTMLElement>('.segment-editor-panel')
  if (!panel) return

  const rows = Array.from(
    panel.querySelectorAll<HTMLButtonElement>('.combined-route-sequence > .combined-segment-row'),
  )
  if (!rows.length) return

  rebuilding = true
  button.disabled = true
  const originalText = button.textContent ?? 'Перестроить весь маршрут автоматически'

  try {
    let rebuilt = 0
    let skipped = 0
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!
      if (row.querySelector('.segment-fixed')) {
        skipped += 1
        continue
      }

      button.textContent = `Строим отрезок ${index + 1} из ${rows.length}…`
      row.click()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

      const buildButton = Array.from(
        panel.querySelectorAll<HTMLButtonElement>('.segment-tools button'),
      ).find((candidate) => candidate.textContent?.includes('Построить этот сегмент автоматически'))
      if (!buildButton || buildButton.disabled) {
        skipped += 1
        continue
      }

      buildButton.click()
      await waitFor(() => !buildButton.textContent?.includes('Прокладываем'))
      rebuilt += 1
    }

    button.textContent = `Готово: ${rebuilt}, пропущено: ${skipped}`
    window.setTimeout(() => {
      button.textContent = originalText
    }, 2500)
  } catch (error) {
    button.textContent = error instanceof Error ? error.message : 'Не удалось перестроить маршрут'
    window.setTimeout(() => {
      button.textContent = originalText
    }, 3500)
  } finally {
    button.disabled = false
    rebuilding = false
  }
}

function enhance() {
  const panel = document.querySelector<HTMLElement>(
    '.segment-editor-panel:not(.route-schedule-panel)',
  )
  if (!panel || panel.querySelector('[data-rebuild-all-route]')) return

  const heading = panel.querySelector<HTMLElement>('.route-order-heading')
  if (!heading) return

  const button = document.createElement('button')
  button.type = 'button'
  button.dataset.rebuildAllRoute = 'true'
  button.className = 'rebuild-all-route-button secondary'
  button.textContent = 'Перестроить весь маршрут автоматически'
  button.onclick = () => void rebuildAll(button)
  heading.after(button)
}

export function initRouteRebuildAllEnhancer() {
  if (observer) return
  observer = new MutationObserver(enhance)
  observer.observe(document.body, { childList: true, subtree: true })
  enhance()
}
