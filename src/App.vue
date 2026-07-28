<script setup lang="ts">
import { useRegisterSW } from 'virtual:pwa-register/vue'
import { provide, ref, watch } from 'vue'
import { RouterView } from 'vue-router'
import { useTransitStore } from '@/stores/transit'

const { updateServiceWorker } = useRegisterSW({ immediate: true })
const transit = useTransitStore()
const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.1.0'

const showUpdateModal = ref(false)

watch(
  () => transit.serverVersion,
  (newVersion) => {
    if (newVersion && newVersion !== appVersion) {
      showUpdateModal.value = true
    }
  },
  { immediate: true },
)

function doUpdate() {
  updateServiceWorker(true)
  window.location.reload()
}

provide('appVersion', appVersion)
provide('updateApp', doUpdate)
</script>

<template>
  <RouterView />
  
  <Teleport to="body">
    <div v-if="showUpdateModal" class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div class="bg-background p-6 rounded-lg shadow-lg max-w-sm w-full">
        <h2 class="text-lg font-bold mb-2">Доступно обновление</h2>
        <p class="text-sm text-muted-foreground mb-6">
          Версия приложения устарела. Рекомендуется обновить для стабильной работы.
        </p>
        <div class="flex justify-end gap-3">
          <button class="px-4 py-2 text-sm rounded border border-border" @click="showUpdateModal = false">Отмена</button>
          <button class="px-4 py-2 text-sm rounded bg-primary text-primary-foreground" @click="doUpdate">Обновить</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
