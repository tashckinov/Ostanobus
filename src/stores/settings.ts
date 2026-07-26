import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useSettingsStore = defineStore('settings', () => {
  const debugMode = ref(false)
  const timeOffsetHours = ref(0)
  
  return {
    debugMode,
    timeOffsetHours,
  }
})
