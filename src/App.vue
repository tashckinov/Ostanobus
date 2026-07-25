<script setup lang="ts">
import { useRegisterSW } from 'virtual:pwa-register/vue'
import { RouterView } from 'vue-router'

useRegisterSW({ immediate: true })
</script>

<template>
  <RouterView />
</template>
