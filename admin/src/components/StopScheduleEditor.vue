<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'

import { api } from '../api'
import type { Schedule, Stop } from '../types'

const props = defineProps<{
  routeNumber: string
  directionId: string
  directionName: string
  stop: Stop
}>()

const emit = defineEmits<{
  close: []
}>()

const schedules = ref<Schedule[]>([])
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

const form = reactive<Schedule>(emptyForm())

const visibleSchedules = computed(() =>
  schedules.value.filter(
    (schedule) => schedule.directionId === props.directionId && schedule.stopId === props.stop.id,
  ),
)

function emptyForm(type: Schedule['type'] = 'interval'): Schedule {
  return {
    directionId: props.directionId,
    stopId: props.stop.id,
    days: [1, 2, 3, 4, 5, 6, 7],
    type,
    departureTime: type === 'exact' ? '06:00' : null,
    startTime: type === 'interval' ? '06:00' : null,
    endTime: type === 'interval' ? '23:00' : null,
    headwayMinutes: type === 'interval' ? 20 : null,
    active: true,
  }
}

function resetForm(type: Schedule['type'] = form.type) {
  Object.assign(form, emptyForm(type))
  message.value = ''
}

function changeType(type: Schedule['type']) {
  resetForm(type)
}

function editSchedule(schedule: Schedule) {
  Object.assign(form, {
    ...schedule,
    days: [...schedule.days],
  })
  message.value = ''
}

function toggleDay(day: number) {
  form.days = form.days.includes(day)
    ? form.days.filter((item) => item !== day)
    : [...form.days, day].sort()
}

function scheduleTime(schedule: Schedule) {
  return schedule.type === 'exact'
    ? (schedule.departureTime ?? 'Время не задано')
    : `${schedule.startTime}–${schedule.endTime}, каждые ${schedule.headwayMinutes} мин`
}

async function loadSchedules() {
  loading.value = true
  try {
    schedules.value = await api.schedules(props.directionId, props.stop.id)
  } finally {
    loading.value = false
  }
}

async function save() {
  message.value = ''
  if (!form.days.length) {
    message.value = 'Выберите хотя бы один день'
    messageType.value = 'error'
    return
  }
  if (form.type === 'exact' && !form.departureTime) {
    message.value = 'Укажите точное время'
    messageType.value = 'error'
    return
  }
  if (form.type === 'interval' && (!form.startTime || !form.endTime || !form.headwayMinutes)) {
    message.value = 'Укажите первый, последний автобус и интервал'
    messageType.value = 'error'
    return
  }

  saving.value = true
  try {
    await api.saveSchedule({ ...form, days: [...form.days] })
    await loadSchedules()
    const savedType = form.type
    resetForm(savedType)
    message.value = 'Расписание сохранено'
    messageType.value = 'success'
  } catch (error) {
    message.value = error instanceof Error ? error.message : 'Не удалось сохранить расписание'
    messageType.value = 'error'
  } finally {
    saving.value = false
  }
}

async function remove(schedule: Schedule) {
  if (!schedule.id) return
  if (!confirm('Удалить эту запись расписания?')) return
  await api.deleteSchedule(schedule.id)
  if (form.id === schedule.id) resetForm(schedule.type)
  await loadSchedules()
}

watch(
  () => [props.directionId, props.stop.id],
  () => {
    resetForm('interval')
    void loadSchedules()
  },
  { immediate: true },
)
</script>

<template>
  <div class="route-stop-schedule">
    <div class="schedule-editor-heading">
      <button class="back-button" title="Вернуться к порядку движения" @click="emit('close')">
        ←
      </button>
      <div>
        <span>Маршрут № {{ routeNumber }} · {{ directionName }}</span>
        <strong>{{ stop.name }}</strong>
      </div>
    </div>

    <form class="route-schedule-form" @submit.prevent="save">
      <div class="mode-switch schedule-mode">
        <button
          type="button"
          :class="{ active: form.type === 'interval' }"
          @click="changeType('interval')"
        >
          Интервал
        </button>
        <button
          type="button"
          :class="{ active: form.type === 'exact' }"
          @click="changeType('exact')"
        >
          Точное время
        </button>
      </div>

      <div>
        <span class="field-label">Дни движения</span>
        <div class="days">
          <button
            v-for="(name, index) in dayNames"
            :key="name"
            type="button"
            :class="{ active: form.days.includes(index + 1) }"
            @click="toggleDay(index + 1)"
          >
            {{ name }}
          </button>
        </div>
      </div>

      <template v-if="form.type === 'interval'">
        <div class="row">
          <label>
            Первый автобус
            <input v-model="form.startTime" type="time" required />
          </label>
          <label>
            Последний автобус
            <input v-model="form.endTime" type="time" required />
          </label>
        </div>
        <label>
          Интервал, минут
          <input v-model.number="form.headwayMinutes" type="number" min="1" max="360" required />
        </label>
      </template>
      <label v-else>
        Время прибытия
        <input v-model="form.departureTime" type="time" required />
      </label>

      <label class="switch-control">
        <input v-model="form.active" type="checkbox" />
        <span>Запись активна</span>
      </label>

      <p v-if="message" class="notice" :class="{ error: messageType === 'error' }">
        {{ message }}
      </p>

      <div class="schedule-form-actions">
        <button type="submit" :disabled="saving">
          {{ saving ? 'Сохраняем…' : form.id ? 'Сохранить изменения' : 'Добавить' }}
        </button>
        <button v-if="form.id" type="button" class="secondary" @click="resetForm(form.type)">
          Отмена
        </button>
      </div>
    </form>

    <div class="schedule-records-heading">
      <strong>Расписание остановки</strong>
      <span>{{ visibleSchedules.length }}</span>
    </div>

    <div v-if="loading" class="empty-state compact">Загрузка…</div>
    <div v-else-if="visibleSchedules.length" class="schedule-records">
      <div v-for="schedule in visibleSchedules" :key="schedule.id" class="schedule-record">
        <button class="schedule-record-main" @click="editSchedule(schedule)">
          <strong>{{ scheduleTime(schedule) }}</strong>
          <span>{{ schedule.days.map((day) => dayNames[day - 1]).join(', ') }}</span>
        </button>
        <button class="text-danger" title="Удалить" @click="remove(schedule)">×</button>
      </div>
    </div>
    <div v-else class="empty-state compact">Для этой остановки расписание ещё не задано.</div>
  </div>
</template>
