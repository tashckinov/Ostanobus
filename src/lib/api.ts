function configuredApiBase() {
  return import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, '') ?? ''
}

export function apiIsConfigured() {
  return Boolean(configuredApiBase())
}

export function apiUrl(path: string) {
  return `${configuredApiBase()}${path}`
}

export async function checkApiHealth(timeoutMs = 5_000): Promise<{ online: boolean; version?: string }> {
  if (!apiIsConfigured() || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    return { online: false }
  }

  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(apiUrl('/api/v1/health'), {
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) return { online: false }
    const body = (await response.json()) as { status?: string; version?: string }
    return { online: body.status === 'ok', version: body.version }
  } catch {
    return { online: false }
  } finally {
    globalThis.clearTimeout(timeout)
  }
}
