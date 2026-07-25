<script setup lang="ts">
import { ArrowLeft, ChevronRight, ExternalLink, MapPin } from '@lucide/vue'

import Button from '@/components/ui/button/Button.vue'
import { useTransitStore } from '@/stores/transit'
import type { StopFeature } from '@/types/transit'

type SheetMode = 'idle' | 'search' | 'stop'

defineProps<{
  mode: SheetMode
  searchResults: StopFeature[]
  locationMessage?: string
}>()

const emit = defineEmits<{
  selectStop: [stopId: string]
  closeSearch: []
  closeStop: []
}>()

const transit = useTransitStore()
</script>

<template>
  <section
    class="safe-bottom fixed inset-x-0 bottom-0 z-30 max-h-[58vh] overflow-y-auto rounded-t-xl border-t border-border bg-background"
    aria-live="polite"
  >
    <div class="sticky top-0 z-10 bg-background">
      <div class="mx-auto mt-2 h-1 w-8 rounded-full bg-border" />

      <div v-if="mode !== 'idle'" class="flex h-12 items-center border-b border-border px-2">
        <Button
          variant="ghost"
          size="icon"
          class="size-10"
          aria-label="Назад"
          @click="mode === 'search' ? emit('closeSearch') : emit('closeStop')"
        >
          <ArrowLeft class="size-5" />
        </Button>
        <h2 class="px-1 text-base font-semibold">
          {{ mode === 'search' ? 'Остановки' : 'Остановка' }}
        </h2>
      </div>
    </div>

    <div v-if="transit.loading" class="px-4 py-5 text-sm text-muted-foreground">
      Загружаем остановки…
    </div>

    <div v-else-if="transit.error" class="px-4 py-4">
      <p class="text-sm">{{ transit.error }}</p>
      <Button variant="outline" size="sm" class="mt-3" @click="transit.initialise()">
        Повторить
      </Button>
    </div>

    <div v-else-if="mode === 'idle'" class="px-4 pb-1 pt-3">
      <h2 class="text-base font-semibold">Остановки Волгодонска</h2>
      <p class="mt-1 text-sm text-muted-foreground">
        Выберите точку на карте или воспользуйтесь поиском.
      </p>
      <p v-if="locationMessage" class="mt-2 text-sm text-red-600">{{ locationMessage }}</p>
      <p class="mt-3 text-xs text-muted-foreground">
        Данные остановок: OpenStreetMap. Маршруты пока не добавлены.
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
      <div class="border-b border-border px-4 py-4">
        <h3 class="text-lg font-semibold">{{ transit.selectedStop.properties.name }}</h3>
        <p class="mt-1 text-sm text-muted-foreground">
          Маршруты для этой остановки ещё не добавлены.
        </p>
      </div>

      <a
        v-if="transit.selectedStop.properties.osmUrl"
        :href="transit.selectedStop.properties.osmUrl"
        target="_blank"
        rel="noreferrer"
        class="flex min-h-12 items-center gap-2 px-4 py-3 text-sm text-primary hover:bg-muted"
      >
        Открыть объект в OpenStreetMap
        <ExternalLink class="size-4" />
      </a>
    </div>
  </section>
</template>
