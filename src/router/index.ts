import { createRouter, createWebHashHistory } from 'vue-router'

import MapPage from '@/views/MapPage.vue'

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'map',
      component: MapPage,
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})
