<script setup lang="ts">
import { ref } from 'vue'

import { login } from '../api'

const emit = defineEmits<{ authenticated: [] }>()
const email = ref('admin@ostanobus.local')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function submit() {
  loading.value = true
  error.value = ''
  try {
    await login(email.value, password.value)
    emit('authenticated')
  } catch {
    error.value = 'Неверная почта или пароль'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="login">
    <form class="login-form" @submit.prevent="submit">
      <h1>Останобус</h1>
      <p>Управление транспортной сетью</p>
      <label>Почта<input v-model="email" type="email" required /></label>
      <label>Пароль<input v-model="password" type="password" required autofocus /></label>
      <p v-if="error" class="error">{{ error }}</p>
      <button :disabled="loading">{{ loading ? 'Вход…' : 'Войти' }}</button>
    </form>
  </main>
</template>
