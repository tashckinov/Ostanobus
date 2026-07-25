<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'

import { api } from '../api'
import TransitMap from '../components/TransitMap.vue'
import type { Stop } from '../types'

const stops = ref<Stop[]>([])
const selectedId = ref<string | null>(null)
const message = ref('')
const form = reactive<Partial<Stop>>({})

async function load() {
  stops.value = await api.stops()
}

function select(stop: Stop) {
  selectedId.value = stop.id
  Object.assign(form, stop)
}

function createAt(longitude: number, latitude: number) {
  selectedId.value = null
  Object.keys(form).forEach((key) => delete form[key as keyof Stop])
  Object.assign(form, {
    cityId: 'volgodonsk',
    name: '',
    shortName: '',
    longitude,
    latitude,
    osmId: null,
    osmUrl: null,
    active: true,
  })
}

async function save() {
  const saved = await api.saveStop(form)
  message.value = 'Остановка сохранена'
  await load()
  select(saved)
}

async function remove() {
  if (!form.id || !confirm(`Удалить остановку «${form.name}»?`)) return
  await api.deleteStop(form.id)
  selectedId.value = null
  Object.keys(form).forEach((key) => delete form[key as keyof Stop])
  await load()
}

onMounted(load)
</script>

<template>
  <section class="editor-page">
    <header class="page-header">
      <div>
        <h1>Остановки</h1>
        <p>Нажмите на карту, чтобы создать остановку.</p>
      </div>
    </header>
    <div class="editor-grid">
      <TransitMap
        :stops="stops"
        :selected-stop-id="selectedId"
        @stop-click="select"
        @map-click="createAt"
      />
      <aside class="panel">
        <template v-if="form.longitude !== undefined">
          <h2>{{ form.id ? 'Остановка' : 'Новая остановка' }}</h2>
          <label>Название<input v-model="form.name" required /></label>
          <label>Короткое название<input v-model="form.shortName" required /></label>
          <div class="row">
            <label>Долгота<input v-model.number="form.longitude" type="number" step="any" /></label>
            <label>Широта<input v-model.number="form.latitude" type="number" step="any" /></label>
          </div>
          <label class="check"><input v-model="form.active" type="checkbox" /> Активна</label>
          <p v-if="message" class="success">{{ message }}</p>
          <div class="actions">
            <button @click="save">Сохранить</button>
            <button v-if="form.id" class="danger" @click="remove">Удалить</button>
          </div>
        </template>
        <p v-else class="muted">Выберите существующую остановку или создайте новую.</p>
      </aside>
    </div>
  </section>
</template>
