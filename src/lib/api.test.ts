import { afterEach, describe, expect, it, vi } from 'vitest'

import { apiUrl, checkApiHealth } from './api'

describe('API health', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('uses the configured API and reports a healthy backend', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://ostanobus.duckdns.org/')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'ok', version: '0.2.0' }),
      }),
    )

    expect(apiUrl('/api/v1/health')).toBe('https://ostanobus.duckdns.org/api/v1/health')
    await expect(checkApiHealth()).resolves.toEqual({ online: true, version: '0.2.0' })
  })

  it('reports offline when the health request fails', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://ostanobus.duckdns.org')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network error')))

    await expect(checkApiHealth()).resolves.toEqual({ online: false })
  })
})
