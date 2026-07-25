import { apiIsConfigured, apiUrl } from '@/lib/api'
import { getClientId, readSetting, writeSetting } from '@/lib/db'
import type { SupportTicketReference } from '@/types/transit'

const settingKey = 'supportTickets'

export interface SupportTicketDraft {
  category: 'stop' | 'route' | 'schedule' | 'forecast' | 'other'
  message: string
  stopId?: string | null
  routeId?: string | null
}

export async function listSupportTickets() {
  return (await readSetting<SupportTicketReference[]>(settingKey)) ?? []
}

export async function submitSupportTicket(draft: SupportTicketDraft) {
  if (!apiIsConfigured()) throw new Error('Backend пока не настроен')
  if (!navigator.onLine) throw new Error('Для отправки обращения нужен интернет')
  const response = await fetch(apiUrl('/api/v1/support/tickets'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...draft, clientId: await getClientId() }),
  })
  if (!response.ok) throw new Error('Не удалось отправить обращение')
  const created = (await response.json()) as Pick<SupportTicketReference, 'id' | 'token' | 'status'>
  const now = new Date().toISOString()
  const ticket: SupportTicketReference = {
    ...created,
    adminReply: null,
    createdAt: now,
    updatedAt: now,
  }
  const tickets = await listSupportTickets()
  await writeSetting(settingKey, [ticket, ...tickets].slice(0, 20))
  return ticket
}

export async function refreshSupportTickets() {
  const tickets = await listSupportTickets()
  if (!apiIsConfigured() || !navigator.onLine || !tickets.length) return tickets
  const refreshed = await Promise.all(
    tickets.map(async (ticket) => {
      try {
        const response = await fetch(
          apiUrl(
            `/api/v1/support/tickets/${encodeURIComponent(ticket.id)}?token=${encodeURIComponent(ticket.token)}`,
          ),
        )
        if (!response.ok) return ticket
        const status = (await response.json()) as Omit<SupportTicketReference, 'token'>
        return { ...status, token: ticket.token }
      } catch {
        return ticket
      }
    }),
  )
  await writeSetting(settingKey, refreshed)
  return refreshed
}
