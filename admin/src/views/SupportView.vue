<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { api } from '../api'

type Ticket = Record<string, string | null>
const tickets = ref<Ticket[]>([])
const selected = ref<Ticket | null>(null)
const reply = ref('')
const status = ref('new')

async function load() {
  tickets.value = await api.tickets()
}

function select(ticket: Ticket) {
  selected.value = ticket
  reply.value = ticket.adminReply ?? ''
  status.value = ticket.status ?? 'new'
}

async function save() {
  if (!selected.value?.id) return
  await api.updateTicket(selected.value.id, status.value, reply.value || null)
  await load()
  const updated = tickets.value.find((ticket) => ticket.id === selected.value?.id)
  if (updated) select(updated)
}

onMounted(load)
</script>

<template>
  <section>
    <header class="page-header"><h1>Обращения</h1></header>
    <div class="support-grid">
      <div class="ticket-list">
        <button
          v-for="ticket in tickets"
          :key="ticket.id!"
          :class="{ active: selected?.id === ticket.id }"
          @click="select(ticket)"
        >
          <strong>{{ ticket.category }}</strong>
          <span>{{ ticket.message }}</span>
          <small>{{ ticket.status }}</small>
        </button>
      </div>
      <div v-if="selected" class="panel">
        <h2>Обращение</h2>
        <p>{{ selected.message }}</p>
        <dl>
          <dt>Маршрут</dt>
          <dd>{{ selected.routeId ?? '—' }}</dd>
          <dt>Остановка</dt>
          <dd>{{ selected.stopId ?? '—' }}</dd>
          <dt>Устройство</dt>
          <dd class="mono">{{ selected.clientId }}</dd>
        </dl>
        <label
          >Статус
          <select v-model="status">
            <option value="new">Новое</option>
            <option value="in_progress">В работе</option>
            <option value="resolved">Решено</option>
            <option value="rejected">Отклонено</option>
          </select>
        </label>
        <label>Ответ<textarea v-model="reply" rows="6" /></label>
        <button @click="save">Сохранить ответ</button>
      </div>
      <p v-else class="muted">Выберите обращение.</p>
    </div>
  </section>
</template>
