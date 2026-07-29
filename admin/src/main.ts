import 'maplibre-gl/dist/maplibre-gl.css'
import './styles.css'
import './route-sequence-enhancer.css'

import { createApp } from 'vue'

import App from './App.vue'
import { initRoadAnchorRebuild } from './road-anchor-rebuild'
import { initRouteRebuildAllEnhancer } from './route-rebuild-all-enhancer'
import { initRouteSequenceEnhancer } from './route-sequence-enhancer'

createApp(App).mount('#app')
initRouteSequenceEnhancer()
initRouteRebuildAllEnhancer()
initRoadAnchorRebuild()
