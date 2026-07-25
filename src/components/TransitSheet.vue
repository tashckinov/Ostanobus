<script setup lang="ts">
import {
  ArrowLeft,
  BusFront,
  Check,
  ChevronRight,
  Clock3,
  History,
  MessageCircle,
  MapPin,
  Send,
  Square,
} from '@lucide/vue'
import { computed, onMounted, ref, watch } from 'vue'

import Button from '@/components/ui/button/Button.vue'
import { useRideStore } from '@/stores/ride'
import { useTransitStore } from '@/stores/transit'
import { refreshSupportTickets, submitSupportTicket, type SupportTicketDraft } from '@/lib/support'
import type { SupportTicketReference } from '@/types/transit'
import type { StopFeature } from '@/types/transit'

type SheetMode = 'idle' | 'search' | 'stop' | 'ride' | 'history' | 'support'

const props = defineProps<{
  mode: SheetMode
  searchResults: StopFeature[]
  locationMessage?: string
}>()

const emit = defineEmits<{
  selectStop: [stopId: string]
  closeSearch: []
  closeStop: []
  openHistory: []
  closeHistory: []
  openSupport: []
  closeSupport: []
  rideStarted: []
}>()

const transit = useTransitStore()
const ride = useRideStore()
const savingArrival = ref(false)
const startingRide = ref(false)
const markingStop = ref(false)
const actionMessage = ref('')
const supportMessage = ref('')
const supportCategory = ref<SupportTicketDraft['category']>('other')
const supportSending = ref(false)
const supportError = ref('')
const supportTickets = ref<SupportTicketReference[]>([])

const selectedForecast = computed(() => transit.selectedStopForecasts[0])
const selectedDirection = computed(() => {
  const forecast = selectedForecast.value
  const stop = transit.selectedStop
  if (!forecast || !stop) return undefined
  return forecast.route.directions.find((direction) =>
    direction.stopIds.includes(stop.properties.id),
  )
})
const activeRoute = computed(() =>
  ride.activeRide
    ? transit.routeStops.routes.find((route) => route.routeId === ride.activeRide?.routeId)
    : undefined,
)
const activeDirection = computed(() =>
  ride.activeRide && activeRoute.value
    ? activeRoute.value.directions.find(
        (direction) => direction.id === ride.activeRide?.directionId,
      )
    : undefined,
)
const nextStop = computed(() => {
  if (!ride.activeRide || !activeDirection.value) return undefined
  const stopId = activeDirection.value.stopIds[ride.activeRide.nextStopIndex]
  return stopId ? transit.stopsById.get(stopId) : undefined
})
const rideComplete = computed(
  () =>
    Boolean(ride.activeRide && activeDirection.value) &&
    ride.activeRide!.nextStopIndex >= activeDirection.value!.stopIds.length,
)

async function recordArrival() {
  const forecast = selectedForecast.value
  const direction = selectedDirection.value
  const stop = transit.selectedStop
  if (!forecast || !stop) return

  savingArrival.value = true
  actionMessage.value = ''
  try {
    await ride.recordArrival(forecast.routeId, stop.properties.id, direction?.id ?? null)
    actionMessage.value = 'Прибытие сохранено · pending'
  } finally {
    savingArrival.value = false
  }
}

async function startRide() {
  const forecast = selectedForecast.value
  const direction = selectedDirection.value
  const stop = transit.selectedStop
  if (!forecast || !direction || !stop) return

  startingRide.value = true
  try {
    await ride.startRide(forecast.route, direction, stop.properties.id)
    emit('rideStarted')
  } finally {
    startingRide.value = false
  }
}

async function markNextStop() {
  if (!activeDirection.value) return
  markingStop.value = true
  try {
    await ride.markNextStop(activeDirection.value)
  } finally {
    markingStop.value = false
  }
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

async function refreshTickets() {
  supportTickets.value = await refreshSupportTickets()
}

async function sendTicket() {
  if (supportMessage.value.trim().length < 3) return
  supportSending.value = true
  supportError.value = ''
  try {
    await submitSupportTicket({
      category: supportCategory.value,
      message: supportMessage.value.trim(),
      stopId: transit.selectedStopId,
      routeId: selectedForecast.value?.routeId ?? null,
    })
    supportMessage.value = ''
    await refreshTickets()
  } catch (error) {
    supportError.value = error instanceof Error ? error.message : 'Не удалось отправить обращение'
  } finally {
    supportSending.value = false
  }
}

watch(
  () => props.mode,
  (mode) => {
    if (mode === 'support') void refreshTickets()
  },
)
onMounted(refreshTickets)
</script>

<template>
  <section
    class="safe-bottom fixed inset-x-0 bottom-0 z-30 max-h-[62vh] overflow-y-auto rounded-t-xl border-t border-border bg-background"
    aria-live="polite"
  >
    <div class="sticky top-0 z-10 bg-background">
      <div class="mx-auto mt-2 h-1 w-8 rounded-full bg-border" />

      <div
        v-if="mode === 'search' || mode === 'stop' || mode === 'history' || mode === 'support'"
        class="flex h-12 items-center border-b border-border px-2"
      >
        <Button
          variant="ghost"
          size="icon"
          class="size-10"
          aria-label="Назад"
          @click="
            mode === 'search'
              ? emit('closeSearch')
              : mode === 'support'
                ? emit('closeSupport')
                : mode === 'history'
                  ? emit('closeHistory')
                  : emit('closeStop')
          "
        >
          <ArrowLeft class="size-5" />
        </Button>
        <h2 class="px-1 text-base font-semibold">
          {{
            mode === 'search'
              ? 'Остановки'
              : mode === 'history'
                ? 'История'
                : mode === 'support'
                  ? 'Поддержка'
                  : 'Остановка'
          }}
        </h2>
      </div>
    </div>

    <div v-if="transit.loading" class="px-4 py-5 text-sm text-muted-foreground">
      Загружаем данные…
    </div>

    <div v-else-if="transit.error" class="px-4 py-4">
      <p class="text-sm">{{ transit.error }}</p>
      <Button variant="outline" size="sm" class="mt-3" @click="transit.initialise()">
        Повторить
      </Button>
    </div>

    <div v-else-if="mode === 'idle'" class="px-4 pb-1 pt-3">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold">Остановки Волгодонска</h2>
          <p class="mt-1 text-sm text-muted-foreground">Выберите остановку маршрута 3К на карте.</p>
        </div>
        <div class="flex gap-2">
          <Button variant="outline" size="sm" @click="emit('openSupport')">
            <MessageCircle class="size-4" />
            Поддержка
          </Button>
          <Button variant="outline" size="sm" @click="emit('openHistory')">
            <History class="size-4" />
            История
          </Button>
        </div>
      </div>
      <p v-if="locationMessage" class="mt-2 text-sm text-red-600">{{ locationMessage }}</p>
      <p class="mt-3 text-xs text-muted-foreground">
        Синий маршрут и прогнозы — тестовые. Остановки загружены из OpenStreetMap.
      </p>
    </div>

    <div v-else-if="mode === 'search'">
      <p v-if="locationMessage" class="border-b border-border px-4 py-3 text-sm text-red-600">
        {{ locationMessage }}
      </p>
      <button
        v-for="stop in searchResults"
        :key="stop.properties.id"
        class="flex min-h-14 w-full items-center gap-3 border-b border-border px-4 py-3 text-left hover:bg-muted"
        @click="emit('selectStop', stop.properties.id)"
      >
        <MapPin class="size-5 shrink-0 text-muted-foreground" />
        <span class="flex-1 text-[15px]">{{ stop.properties.name }}</span>
        <ChevronRight class="size-4 text-muted-foreground" />
      </button>
      <p v-if="!searchResults.length" class="px-4 py-5 text-sm text-muted-foreground">
        Остановки не найдены
      </p>
    </div>

    <div v-else-if="mode === 'stop' && transit.selectedStop">
      <div class="border-b border-border px-4 py-3">
        <h3 class="text-lg font-semibold">{{ transit.selectedStop.properties.name }}</h3>
      </div>

      <div v-if="selectedForecast" class="border-b border-border px-4 py-3">
        <div class="flex items-center">
          <span class="w-16 text-base font-semibold">№ {{ selectedForecast.route.number }}</span>
          <span class="flex-1">
            <span class="block text-[15px] font-medium">
              {{ selectedForecast.minMinutes }}–{{ selectedForecast.maxMinutes }} мин
            </span>
            <span class="block text-xs text-muted-foreground">Вероятностный прогноз</span>
          </span>
        </div>

        <div class="mt-3 grid grid-cols-2 gap-2">
          <Button :disabled="savingArrival" @click="recordArrival">
            <Check class="size-4" />
            Автобус прибыл
          </Button>
          <Button variant="outline" :disabled="startingRide" @click="startRide">
            <BusFront class="size-4" />
            Я сел
          </Button>
        </div>

        <p v-if="actionMessage" class="mt-2 text-xs text-muted-foreground">
          {{ actionMessage }}
        </p>
      </div>

      <p v-else class="px-4 py-4 text-sm text-muted-foreground">
        Тестовый маршрут 3К через эту платформу не проходит.
      </p>
    </div>

    <div v-else-if="mode === 'ride' && ride.activeRide && activeRoute && activeDirection">
      <div class="flex items-start border-b border-border px-4 py-3">
        <div class="flex-1">
          <p class="text-sm text-muted-foreground">
            Маршрут {{ activeRoute.number }} · {{ activeDirection.name }}
          </p>
          <h2 class="mt-1 text-lg font-semibold">
            {{ nextStop ? nextStop.properties.name : 'Конечная остановка' }}
          </h2>
        </div>
        <span class="text-xs text-muted-foreground">{{ ride.pendingCount }} pending</span>
      </div>

      <p
        v-if="ride.justSavedStopId"
        class="flex items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground"
      >
        <Check class="size-4 text-green-600" />
        {{ eventStopName(ride.justSavedStopId) }} сохранена
      </p>

      <div class="flex gap-2 px-4 pt-4">
        <Button v-if="!rideComplete" class="flex-1" :disabled="markingStop" @click="markNextStop">
          <MapPin class="size-4" />
          Проехали остановку
        </Button>
        <Button v-else class="flex-1" @click="ride.finishRide()">Завершить поездку</Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Завершить поездку"
          @click="ride.finishRide()"
        >
          <Square class="size-4 fill-current" />
        </Button>
      </div>
    </div>

    <div v-else-if="mode === 'history'">
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
        <span class="text-xs text-muted-foreground">{{ event.status }}</span>
      </div>
      <p v-if="!ride.events.length" class="px-4 py-5 text-sm text-muted-foreground">
        Локальных отметок пока нет.
      </p>
    </div>

    <div v-else-if="mode === 'support'" class="px-4 pb-2 pt-3">
      <label class="block text-xs font-medium text-muted-foreground">
        Тема
        <select
          v-model="supportCategory"
          class="mt-1 h-10 w-full rounded border border-border bg-background px-2 text-sm"
        >
          <option value="stop">Остановка</option>
          <option value="route">Маршрут</option>
          <option value="schedule">Расписание</option>
          <option value="forecast">Прогноз</option>
          <option value="other">Другое</option>
        </select>
      </label>
      <label class="mt-3 block text-xs font-medium text-muted-foreground">
        Сообщение
        <textarea
          v-model="supportMessage"
          rows="4"
          maxlength="4000"
          class="mt-1 w-full resize-none rounded border border-border bg-background p-2 text-sm text-foreground"
          placeholder="Опишите проблему"
        />
      </label>
      <Button
        class="mt-2 w-full"
        :disabled="supportSending || supportMessage.trim().length < 3"
        @click="sendTicket"
      >
        <Send class="size-4" />
        {{ supportSending ? 'Отправляем…' : 'Отправить обращение' }}
      </Button>
      <p v-if="supportError" class="mt-2 text-xs text-red-600">{{ supportError }}</p>

      <div v-if="supportTickets.length" class="mt-4 border-t border-border">
        <div v-for="ticket in supportTickets" :key="ticket.id" class="border-b border-border py-3">
          <div class="flex justify-between gap-2">
            <span class="text-sm font-medium">Обращение</span>
            <span class="text-xs text-muted-foreground">{{ ticket.status }}</span>
          </div>
          <p v-if="ticket.adminReply" class="mt-1 text-sm">{{ ticket.adminReply }}</p>
          <p v-else class="mt-1 text-xs text-muted-foreground">Ответа пока нет</p>
        </div>
      </div>
    </div>
  </section>
</template>
