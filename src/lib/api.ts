const configuredApiBase = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, '') ?? ''

export function apiIsConfigured() {
  return Boolean(configuredApiBase)
}

export function apiUrl(path: string) {
  return `${configuredApiBase}${path}`
}
