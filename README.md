# Останобус

Кликабельный PWA-прототип вероятностного прогноза городского транспорта. Карта — основной
интерфейс: пассажир выбирает остановку, видит тестовый диапазон прибытия автобуса и во время
поездки локально отмечает прохождение остановок.

## Что работает

- карта Волгодонска на MapLibre GL JS и OpenStreetMap;
- два тестовых маршрута и семь остановок из локальных GeoJSON;
- вероятностный прогноз по тестовым историческим данным;
- выбор маршрута и направления поездки;
- сохранение отметок в IndexedDB через Dexie;
- локальная очередь событий без backend;
- PWA-манифест, service worker и кэш открытых тайлов карты;
- сборка, тесты и публикация в GitHub Pages через Actions.

Прогнозы в MVP демонстрационные. Приложение не показывает реальное положение транспорта и не
отправляет события с устройства.

## Локальный запуск

```bash
npm install
npm run dev
```

Проверка перед публикацией:

```bash
npm run check
```

## Данные MVP

```text
public/data/
├── stops.geojson
├── routes.geojson
├── route-stops.json
└── historical-arrivals.json
```

## GitHub Pages

Workflow `.github/workflows/deploy-pages.yml` собирает проект на `main` и публикует папку `dist`.
В настройках репозитория нужно выбрать **Settings → Pages → Source: GitHub Actions**.

Vite настроен на базовый путь `/Ostanobus/`, а маршрутизация использует hash history, поэтому
прямое открытие экранов работает на GitHub Pages.

## Стек

Vue 3, Vite, TypeScript, shadcn-vue, Tailwind CSS, Vue Router, Pinia, MapLibre GL JS, Dexie,
vite-plugin-pwa, Workbox, Vitest, ESLint и Prettier.
