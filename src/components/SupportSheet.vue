<script setup lang="ts">
import { ArrowLeft, Send } from '@lucide/vue'
import { onBeforeUnmount, onMounted, ref } from 'vue'

import Button from '@/components/ui/button/Button.vue'
import { refreshSupportTickets, submitSupportTicket, type SupportTicketDraft } from '@/lib/support'
import { useTransitStore } from '@/stores/transit'
import type { SupportTicketReference } from '@/types/transit'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [open: boolean] }>()

const transit = useTransitStore()
const message = ref('')
const category = ref<SupportTicketDraft['category']>('other')
const sending = ref(false)
const errorMessage = ref('')
const tickets = ref<SupportTicketReference[]>([])

function close() {
  emit('update:open', false)
}

async function loadTickets() {
  tickets.value = await refreshSupportTickets()
}

async function sendTicket() {
  if (message.value.trim().length < 3) return
  sending.value = true
  errorMessage.value = ''
  try {
    await submitSupportTicket({
      category: category.value,
      message: message.value.trim(),
      stopId: transit.selectedStopId,
      routeId: null,
    })
    message.value = ''
    await loadTickets()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Не удалось отправить обращение'
  } finally {
    sending.value = false
  }
}

function onKeydown(event: KeyboardEvent) {
  if (props.open && event.key === 'Escape') close()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  void loadTickets()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <section
      v-if="open"
      class="fixed inset-0 z-50 flex flex-col bg-background"
      role="dialog"
      aria-modal="true"
      aria-label="Поддержка"
    >
      <header class="safe-top flex min-h-16 items-center border-b border-border px-2">
        <Button variant="ghost" size="icon" class="size-10" aria-label="Назад" @click="close">
          <ArrowLeft class="size-5" />
        </Button>
        <h1 class="px-2 text-lg font-semibold">Поддержка</h1>
      </header>

      <div class="safe-bottom min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <label class="block text-xs font-medium text-muted-foreground">
          Тема
          <select
            v-model="category"
            class="mt-1 h-10 w-full rounded border border-border bg-background px-2 text-sm"
          >
            <option value="stop">Остановка</option>
            <option value="route">Маршрут</option>
            <option value="schedule">Расписание</option>
            <option value="forecast">Прогноз</option>
            <option value="other">Другое</option>
          </select>
        </label>

        <label class="mt-3 block text-xs font-medium text-muted-foreground">
          Сообщение
          <textarea
            v-model="message"
            rows="6"
            maxlength="4000"
            class="mt-1 w-full resize-none rounded border border-border bg-background p-2 text-sm"
            placeholder="Опишите проблему"
          />
        </label>

        <Button
          class="mt-2 w-full"
          :disabled="sending || message.trim().length < 3"
          @click="sendTicket"
        >
          <Send class="size-4" />
          {{ sending ? 'Отправляем…' : 'Отправить обращение' }}
        </Button>
        <p v-if="errorMessage" class="mt-2 text-xs text-red-600">{{ errorMessage }}</p>

        <div v-if="tickets.length" class="mt-6 border-t border-border">
          <div v-for="ticket in tickets" :key="ticket.id" class="border-b border-border py-3">
            <div class="flex justify-between gap-2">
              <span class="text-sm font-medium">Обращение</span>
              <span class="text-xs text-muted-foreground">{{ ticket.status }}</span>
            </div>
            <p v-if="ticket.adminReply" class="mt-1 text-sm">{{ ticket.adminReply }}</p>
            <p v-else class="mt-1 text-xs text-muted-foreground">Ответа пока нет</p>
          </div>
        </div>
      </div>
    </section>
  </Teleport>
</template>
