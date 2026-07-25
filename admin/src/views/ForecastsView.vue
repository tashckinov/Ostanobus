<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { api } from '../api'
import type { Forecast, Route, Stop } from '../types'

const forecasts = ref<Forecast[]>([])
const routes = ref<Route[]>([])
const stops = ref<Stop[]>([])
const form = reactive<Forecast>({
  stopId: '',
  routeId: '',
  directionId: null,
  minMinutes: 5,
  maxMinutes: 10,
  confidence: 'medium',
  sampleSize: 0,
  active: true,
})
const stopNames = computed(() => new Map(stops.value.map((stop) => [stop.id, stop.name])))

async function load() {
  ;[forecasts.value, routes.value, stops.value] = await Promise.all([
    api.forecasts(),
    api.routes(),
    api.stops(),
  ])
  form.stopId ||= stops.value[0]?.id ?? ''
  form.routeId ||= routes.value[0]?.routeId ?? ''
}

async function save() {
  await api.saveForecast(form)
  Object.assign(form, { id: undefined })
  await load()
}

function edit(item: Forecast) {
  Object.assign(form, item)
}

async function remove(id?: string) {
  if (!id) return
  await api.deleteForecast(id)
  await load()
}

onMounted(load)
</script>

<template>
  <section>
    <header class="page-header"><h1>Прогнозы</h1></header>
    <div class="content-grid">
      <form class="panel" @submit.prevent="save">
        <label
          >Остановка
          <select v-model="form.stopId">
            <option v-for="stop in stops" :key="stop.id" :value="stop.id">{{ stop.name }}</option>
          </select>
        </label>
        <label
          >Маршрут
          <select v-model="form.routeId">
            <option v-for="route in routes" :key="route.routeId" :value="route.routeId">
              № {{ route.number }}
            </option>
          </select>
        </label>
        <div class="row">
          <label>От, мин<input v-model.number="form.minMinutes" type="number" min="0" /></label>
          <label>До, мин<input v-model.number="form.maxMinutes" type="number" min="0" /></label>
        </div>
        <label
          >Уверенность
          <select v-model="form.confidence">
            <option value="high">Высокая</option>
            <option value="medium">Средняя</option>
            <option value="low">Низкая</option>
          </select>
        </label>
        <label
          >Размер выборки<input v-model.number="form.sampleSize" type="number" min="0"
        /></label>
        <button>Сохранить</button>
      </form>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Остановка</th>
              <th>Маршрут</th>
              <th>Прогноз</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in forecasts" :key="item.id">
              <td>{{ stopNames.get(item.stopId) ?? item.stopId }}</td>
              <td>{{ routes.find((route) => route.routeId === item.routeId)?.number }}</td>
              <td>{{ item.minMinutes }}–{{ item.maxMinutes }} мин</td>
              <td>
                <button class="text-button" @click="edit(item)">Изменить</button>
                <button class="text-danger" @click="remove(item.id)">Удалить</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
