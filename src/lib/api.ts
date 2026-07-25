function configuredApiBase() {
  return import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, '') ?? ''
}

export function apiIsConfigured() {
  return Boolean(configuredApiBase())
}

export function apiUrl(path: string) {
  return `${configuredApiBase()}${path}`
}

export async function checkApiHealth(timeoutMs = 5_000) {
  if (!apiIsConfigured() || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    return false
  }

  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(apiUrl('/api/v1/health'), {
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) return false
    const body = (await response.json()) as { status?: string }
    return body.status === 'ok'
  } catch {
    return false
  } finally {
    globalThis.clearTimeout(timeout)
  }
}
