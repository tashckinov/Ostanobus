<script setup lang="ts">
import {
  ArrowLeft,
  BusFront,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileCheck2,
  History,
  Info,
  MapPin,
  Settings,
  Star,
  X,
} from '@lucide/vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import Button from '@/components/ui/button/Button.vue'
import { useRideStore } from '@/stores/ride'
import { useTransitStore } from '@/stores/transit'

type DrawerView = 'menu' | 'routes' | 'history' | 'marks' | 'favorites' | 'about' | 'settings'
type DrawerTarget = DrawerView | 'support'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  'update:open': [open: boolean]
  openSupport: []
}>()

const transit = useTransitStore()
const ride = useRideStore()
const view = ref<DrawerView>('menu')

const title = computed(() => {
  const titles: Record<DrawerView, string> = {
    menu: 'Останобус',
    routes: 'Маршруты',
    history: 'История поездок',
    marks: 'Мои отметки',
    favorites: 'Избранные остановки',
    about: 'О приложении',
    settings: 'Настройки',
  }
  return titles[view.value]
})

const menuGroups = [
  [
    { id: 'routes' as const, label: 'Маршруты', icon: BusFront },
    { id: 'history' as const, label: 'История поездок', icon: History },
    { id: 'marks' as const, label: 'Мои отметки', icon: FileCheck2 },
    { id: 'favorites' as const, label: 'Избранные остановки', icon: Star },
  ],
  [
    { id: 'support' as const, label: 'Поддержка', icon: CircleHelp },
    { id: 'about' as const, label: 'О приложении', icon: Info },
    { id: 'settings' as const, label: 'Настройки', icon: Settings },
  ],
]

function close() {
  emit('update:open', false)
}

function openView(next: DrawerTarget) {
  if (next === 'support') {
    emit('openSupport')
    return
  }
  view.value = next
}

function eventTitle(type: 'bus_arrival' | 'stop_passage', routeId: string) {
  const route = transit.routeStops.routes.find((item) => item.routeId === routeId)
  const routeNumber = route?.number ?? routeId
  return type === 'bus_arrival'
    ? `Автобус ${routeNumber} прибыл`
    : `Проехали остановку · ${routeNumber}`
}

function eventStopName(stopId: string) {
  return transit.stopsById.get(stopId)?.properties.name ?? stopId
}

function formatEventTime(createdAt: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(createdAt))
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      view.value = 'menu'
      window.addEventListener('keydown', onKeydown)
    } else {
      window.removeEventListener('keydown', onKeydown)
    }
  },
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50">
      <button class="absolute inset-0 bg-black/35" aria-label="Закрыть меню" @click="close" />
      <aside
        class="safe-bottom absolute inset-y-0 left-0 flex w-[86%] max-w-[340px] flex-col bg-background shadow-xl"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
      >
        <header class="safe-top flex min-h-16 items-center border-b border-border px-2">
          <Button
            v-if="view !== 'menu'"
            variant="ghost"
            size="icon"
            class="size-10"
            aria-label="Назад"
            @click="view = 'menu'"
          >
            <ArrowLeft class="size-5" />
          </Button>
          <h1 class="min-w-0 flex-1 truncate px-2 text-lg font-semibold">{{ title }}</h1>
          <Button variant="ghost" size="icon" class="size-10" aria-label="Закрыть" @click="close">
            <X class="size-5" />
          </Button>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto">
          <template v-if="view === 'menu'">
            <nav
              v-for="(group, groupIndex) in menuGroups"
              :key="groupIndex"
              class="border-b border-border py-2"
            >
              <button
                v-for="item in group"
                :key="item.id"
                class="flex min-h-12 w-full items-center gap-3 px-4 text-left hover:bg-muted"
                @click="openView(item.id)"
              >
                <component :is="item.icon" class="size-5 text-muted-foreground" />
                <span class="flex-1 text-[15px]">{{ item.label }}</span>
                <ChevronRight class="size-4 text-muted-foreground" />
              </button>
            </nav>
          </template>

          <div v-else-if="view === 'routes'">
            <div
              v-for="route in transit.routeStops.routes"
              :key="route.routeId"
              class="flex min-h-14 items-center gap-3 border-b border-border px-4 py-2"
            >
              <span
                class="grid size-9 place-items-center rounded-full border-2 bg-background text-xs font-semibold"
                :style="{ borderColor: route.color }"
              >
                {{ route.number }}
              </span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">
                  {{ route.directions[0]?.name || `Маршрут № ${route.number}` }}
                </p>
                <p class="text-xs text-muted-foreground">{{ route.directions.length }} направл.</p>
              </div>
            </div>
            <p
              v-if="!transit.routeStops.routes.length"
              class="px-4 py-5 text-sm text-muted-foreground"
            >
              Маршрутов пока нет.
            </p>
          </div>

          <div v-else-if="view === 'history' || view === 'marks'">
            <div
              v-for="event in ride.events"
              :key="event.id"
              class="flex min-h-16 gap-3 border-b border-border px-4 py-3"
            >
              <Clock3 class="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium">{{ eventTitle(event.type, event.routeId) }}</p>
                <p class="truncate text-xs text-muted-foreground">
                  {{ eventStopName(event.stopId) }} · {{ formatEventTime(event.createdAt) }}
                </p>
              </div>
              <span v-if="view === 'marks'" class="text-xs text-muted-foreground">
                {{ event.status }}
              </span>
            </div>
            <p v-if="!ride.events.length" class="px-4 py-5 text-sm text-muted-foreground">
              Записей пока нет.
            </p>
          </div>

          <div v-else-if="view === 'favorites'" class="px-4 py-5">
            <p class="text-sm text-muted-foreground">Избранных остановок пока нет.</p>
          </div>

          <div v-else-if="view === 'about'" class="space-y-3 px-4 py-5">
            <p class="text-sm">
              Останобус помогает смотреть расписание остановок и сохранять пассажирские отметки.
            </p>
            <p class="text-xs text-muted-foreground">
              Остановки: OpenStreetMap. Данные поездок сохраняются на устройстве.
            </p>
          </div>

          <div v-else-if="view === 'settings'" class="px-4 py-5">
            <div class="flex items-center justify-between border-b border-border py-3">
              <span class="text-sm">Подключение к серверу</span>
              <span
                class="text-xs font-medium"
                :class="transit.apiOnline ? 'text-green-700' : 'text-red-600'"
              >
                {{ transit.apiOnline ? 'Онлайн' : 'Оффлайн' }}
              </span>
            </div>
            <div class="flex items-center gap-3 py-3 text-sm text-muted-foreground">
              <MapPin class="size-4" />
              Волгодонск
            </div>
          </div>
        </div>
      </aside>
    </div>
  </Teleport>
</template>
