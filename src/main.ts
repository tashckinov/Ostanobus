import 'maplibre-gl/dist/maplibre-gl.css'
import './styles.css'

import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import { initRuntimeUiEnhancer } from './lib/runtime-ui-enhancer'
import router from './router'

const pinia = createPinia()
createApp(App).use(pinia).use(router).mount('#app')
initRuntimeUiEnhancer(pinia)
