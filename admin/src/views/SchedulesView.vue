<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'

import { api } from '../api'
import type { Route, Schedule, Stop } from '../types'

const routes = ref<Route[]>([])
const stops = ref<Stop[]>([])
const schedules = ref<Schedule[]>([])
const saving = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')

const form = reactive<Schedule>({
  directionId: '',
  stopId: null,
  days: [1, 2, 3, 4, 5],
  type: 'interval',
  departureTime: null,
  startTime: '06:00',
  endTime: '09:00',
  headwayMinutes: 15,
  active: true,
})

const directions = computed(() =>
  routes.value.flatMap((route) =>
    route.directions.map((direction) => ({
      id: direction.id,
      label: `№ ${route.number} · ${direction.name}`,
      stopIds: direction.stopIds,
    })),
  ),
)
const selectedDirection = computed(() =>
  directions.value.find((direction) => direction.id === form.directionId),
)
const stopById = computed(() => new Map(stops.value.map((stop) => [stop.id, stop])))
const directionStops = computed(() =>
  (selectedDirection.value?.stopIds ?? [])
    .map((stopId, index) => {
      const stop = stopById.value.get(stopId)
      return stop ? { ...stop, position: index + 1 } : null
    })
    .filter((stop): stop is Stop & { position: number } => Boolean(stop)),
)
const visibleSchedules = computed(() =>
  schedules.value.filter(
    (schedule) =>
      schedule.directionId === form.directionId &&
      (form.stopId ? schedule.stopId === form.stopId : true),
  ),
)

const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

function toggleDay(day: number) {
  form.days = form.days.includes(day)
    ? form.days.filter((item) => item !== day)
    : [...form.days, day].sort()
}

function scheduleStopName(stopId: string | null) {
  return stopId ? (stopById.value.get(stopId)?.name ?? 'Неизвестная остановка') : 'Всё направление'
}

async function save() {
  message.value = ''
  if (!form.directionId || !form.stopId) {
    message.value = 'Выберите направление и остановку'
    messageType.value = 'error'
    return
  }
  if (!form.days.length) {
    message.value = 'Выберите хотя бы один день'
    messageType.value = 'error'
    return
  }

  saving.value = true
  try {
    await api.saveSchedule({ ...form })
    schedules.value = await api.schedules()
    message.value = 'Расписание остановки сохранено'
    messageType.value = 'success'
  } catch (error) {
    message.value = error instanceof Error ? error.message : 'Не удалось сохранить расписание'
    messageType.value = 'error'
  } finally {
    saving.value = false
  }
}

async function remove(id?: string) {
  if (!id) return
  await api.deleteSchedule(id)
  schedules.value = await api.schedules()
}

watch(
  () => form.directionId,
  () => {
    form.stopId = selectedDirection.value?.stopIds[0] ?? null
    message.value = ''
  },
)

onMounted(async () => {
  ;[routes.value, stops.value, schedules.value] = await Promise.all([
    api.routes(),
    api.stops(),
    api.schedules(),
  ])
  form.directionId = directions.value[0]?.id ?? ''
})
</script>

<template>
  <section>
    <header class="page-header">
      <div>
        <h1>Расписание</h1>
        <p>Время задаётся отдельно для каждой остановки направления.</p>
      </div>
    </header>

    <div class="schedule-layout">
      <form class="panel schedule-form" @submit.prevent="save">
        <label>
          Направление
          <select v-model="form.directionId">
            <option v-for="item in directions" :key="item.id" :value="item.id">
              {{ item.label }}
            </option>
          </select>
        </label>

        <label>
          Остановка
          <select v-model="form.stopId" required>
            <option v-for="stop in directionStops" :key="stop.id" :value="stop.id">
              {{ stop.position }}. {{ stop.name }}
            </option>
          </select>
        </label>

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

        <label>
          Режим
          <select v-model="form.type">
            <option value="interval">Интервал движения</option>
            <option value="exact">Точное время прибытия</option>
          </select>
        </label>

        <label v-if="form.type === 'exact'">
          Время прибытия
          <input v-model="form.departureTime" type="time" />
        </label>
        <template v-else>
          <div class="row">
            <label>
              Первый автобус
              <input v-model="form.startTime" type="time" />
            </label>
            <label>
              Последний автобус
              <input v-model="form.endTime" type="time" />
            </label>
          </div>
          <label>
            Интервал, минут
            <input v-model.number="form.headwayMinutes" type="number" min="1" max="360" />
          </label>
        </template>

        <p v-if="message" class="notice" :class="{ error: messageType === 'error' }">
          {{ message }}
        </p>
        <button :disabled="saving">
          {{ saving ? 'Сохраняем…' : 'Добавить расписание' }}
        </button>
      </form>

      <div class="schedule-results">
        <div class="schedule-results-heading">
          <div>
            <span>Выбранная остановка</span>
            <strong>{{ scheduleStopName(form.stopId) }}</strong>
          </div>
          <span>{{ visibleSchedules.length }} записей</span>
        </div>

        <div v-if="visibleSchedules.length" class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Остановка</th>
                <th>Дни</th>
                <th>Время</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in visibleSchedules" :key="item.id">
                <td>{{ scheduleStopName(item.stopId) }}</td>
                <td>{{ item.days.map((day) => dayNames[day - 1]).join(', ') }}</td>
                <td>
                  {{
                    item.type === 'exact'
                      ? item.departureTime
                      : `${item.startTime}–${item.endTime}, каждые ${item.headwayMinutes} мин`
                  }}
                </td>
                <td>
                  <button class="text-danger" @click="remove(item.id)">Удалить</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="empty-state">Для этой остановки расписание ещё не задано.</div>
      </div>
    </div>
  </section>
</template>
