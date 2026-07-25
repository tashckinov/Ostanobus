<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { api } from '../api'
import type { Route, Schedule } from '../types'

const routes = ref<Route[]>([])
const schedules = ref<Schedule[]>([])
const form = reactive<Schedule>({
  directionId: '',
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
      label: `${route.number} · ${direction.name}`,
    })),
  ),
)
const visibleSchedules = computed(() =>
  schedules.value.filter((schedule) => schedule.directionId === form.directionId),
)

const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
function toggleDay(day: number) {
  form.days = form.days.includes(day)
    ? form.days.filter((item) => item !== day)
    : [...form.days, day].sort()
}

async function save() {
  await api.saveSchedule(form)
  schedules.value = await api.schedules()
}

async function remove(id?: string) {
  if (!id) return
  await api.deleteSchedule(id)
  schedules.value = await api.schedules()
}

onMounted(async () => {
  ;[routes.value, schedules.value] = await Promise.all([api.routes(), api.schedules()])
  form.directionId = directions.value[0]?.id ?? ''
})
</script>

<template>
  <section>
    <header class="page-header"><h1>Расписание</h1></header>
    <div class="content-grid">
      <form class="panel" @submit.prevent="save">
        <label
          >Направление
          <select v-model="form.directionId">
            <option v-for="item in directions" :key="item.id" :value="item.id">
              {{ item.label }}
            </option>
          </select>
        </label>
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
        <label
          >Режим
          <select v-model="form.type">
            <option value="interval">Интервал</option>
            <option value="exact">Точное отправление</option>
          </select>
        </label>
        <label v-if="form.type === 'exact'"
          >Время<input v-model="form.departureTime" type="time"
        /></label>
        <template v-else>
          <div class="row">
            <label>С<input v-model="form.startTime" type="time" /></label>
            <label>До<input v-model="form.endTime" type="time" /></label>
          </div>
          <label
            >Интервал, минут<input v-model.number="form.headwayMinutes" type="number" min="1"
          /></label>
        </template>
        <button>Добавить</button>
      </form>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Дни</th>
              <th>Время</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in visibleSchedules" :key="item.id">
              <td>{{ item.days.map((day) => dayNames[day - 1]).join(', ') }}</td>
              <td>
                {{
                  item.type === 'exact'
                    ? item.departureTime
                    : `${item.startTime}–${item.endTime}, каждые ${item.headwayMinutes} мин`
                }}
              </td>
              <td><button class="text-danger" @click="remove(item.id)">Удалить</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
