<script setup lang="ts">
import { ArrowLeft, BusFront, Database, Download, Map, ShieldCheck, WifiOff } from '@lucide/vue'
import { RouterLink } from 'vue-router'

import Button from '@/components/ui/button/Button.vue'
import { useInstallPrompt } from '@/composables/use-install-prompt'

const { canInstall, installed, install } = useInstallPrompt()
</script>

<template>
  <div class="h-full overflow-y-auto bg-background">
    <div class="mx-auto min-h-full max-w-2xl px-4 pb-12 pt-4 sm:pt-8">
      <RouterLink
        to="/"
        class="mb-8 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft class="size-4" />
        На карту
      </RouterLink>

      <div class="flex items-center gap-4">
        <span
          class="flex size-14 items-center justify-center rounded-2xl bg-primary text-secondary"
        >
          <BusFront class="size-7" />
        </span>
        <div>
          <p class="text-sm font-semibold text-muted-foreground">PWA-прототип</p>
          <h1 class="text-3xl font-black tracking-tight">Останобус</h1>
        </div>
      </div>

      <p class="mt-7 text-lg leading-relaxed text-muted-foreground">
        Помогает понять, когда примерно придёт автобус, даже если в городе нет официального
        онлайн-отслеживания.
      </p>

      <Button v-if="canInstall" class="mt-6" @click="install">
        <Download class="size-5" />
        Добавить на главный экран
      </Button>
      <p v-else-if="installed" class="mt-6 text-sm font-semibold text-emerald-700">
        Приложение установлено.
      </p>
      <p v-else class="mt-6 text-sm text-muted-foreground">
        Для установки откройте меню браузера и выберите «Добавить на главный экран».
      </p>

      <div class="mt-10 grid gap-3 sm:grid-cols-2">
        <article class="rounded-2xl border border-border bg-card p-5">
          <Map class="size-6 text-primary" />
          <h2 class="mt-4 font-bold">Карта прежде всего</h2>
          <p class="mt-2 text-sm leading-relaxed text-muted-foreground">
            Маршруты, остановки и вероятностные интервалы находятся на одном экране.
          </p>
        </article>
        <article class="rounded-2xl border border-border bg-card p-5">
          <WifiOff class="size-6 text-primary" />
          <h2 class="mt-4 font-bold">Работает без сети</h2>
          <p class="mt-2 text-sm leading-relaxed text-muted-foreground">
            Оболочка и открытые участки карты кэшируются, а новые отметки ждут отправки локально.
          </p>
        </article>
        <article class="rounded-2xl border border-border bg-card p-5">
          <Database class="size-6 text-primary" />
          <h2 class="mt-4 font-bold">Без ложной точности</h2>
          <p class="mt-2 text-sm leading-relaxed text-muted-foreground">
            Сейчас используются тестовые исторические данные и диапазоны времени.
          </p>
        </article>
        <article class="rounded-2xl border border-border bg-card p-5">
          <ShieldCheck class="size-6 text-primary" />
          <h2 class="mt-4 font-bold">Приватность MVP</h2>
          <p class="mt-2 text-sm leading-relaxed text-muted-foreground">
            Нет аккаунта, GPS-трекинга и отправки данных: события остаются на устройстве.
          </p>
        </article>
      </div>
    </div>
  </div>
</template>
