let rebuildTimer: number | null = null
let rebuilding = false

function waitFor(predicate: () => boolean, timeout = 20_000) {
  return new Promise<boolean>((resolve) => {
    const startedAt = Date.now()
    const check = () => {
      if (predicate()) {
        resolve(true)
        return
      }
      if (Date.now() - startedAt >= timeout) {
        resolve(false)
        return
      }
      window.setTimeout(check, 100)
    }
    check()
  })
}

async function rebuildButton(button: HTMLButtonElement) {
  button.click()
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

  const tools = document.querySelector<HTMLElement>('.segment-tools')
  const buildButton = Array.from(tools?.querySelectorAll<HTMLButtonElement>('button') ?? []).find((candidate) =>
    candidate.textContent?.includes('Построить этот сегмент автоматически'),
  )
  if (!buildButton || buildButton.disabled) return false

  buildButton.click()
  await waitFor(() => {
    const current = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.segment-tools button'),
    ).find((candidate) =>
      candidate.textContent?.includes('Построить этот сегмент автоматически'),
    )
    return Boolean(current && !current.disabled && !current.textContent?.includes('Прокладываем'))
  })
  return true
}

async function rebuildAdjacentSegments() {
  if (rebuilding) return
  const stopName = document.querySelector<HTMLElement>('.map-stop-actions > strong')?.textContent?.trim()
  if (!stopName) return

  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.segment-list > button'),
  ).filter((button) => button.querySelector('strong')?.textContent?.includes(stopName))
  if (!buttons.length) return

  rebuilding = true
  let rebuilt = 0
  try {
    for (const button of buttons) {
      if (await rebuildButton(button)) rebuilt += 1
    }

    const notice = document.querySelector<HTMLElement>('.segment-editor-panel .notice')
    if (notice) {
      notice.classList.remove('error')
      notice.textContent = rebuilt === buttons.length
        ? `Дорожный якорь перемещён. Автоматически перестроено участков: ${rebuilt}.`
        : `Якорь перемещён. Перестроено ${rebuilt} из ${buttons.length} участков; зафиксированные участки не изменены.`
    }
  } finally {
    rebuilding = false
  }
}

export function initRoadAnchorRebuild() {
  document.addEventListener(
    'pointerup',
    (event) => {
      const target = event.target as HTMLElement
      if (!target.closest('.route-anchor-marker')) return
      if (rebuildTimer !== null) window.clearTimeout(rebuildTimer)
      rebuildTimer = window.setTimeout(() => {
        rebuildTimer = null
        void rebuildAdjacentSegments()
      }, 350)
    },
    true,
  )
}
