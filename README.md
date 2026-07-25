# Останобус

Мобильная PWA-карта остановок городского транспорта Волгодонска.

## Что работает

- карта на MapLibre GL JS и OpenStreetMap;
- 275 остановочных платформ из OpenStreetMap;
- тестовый маршрут 3К на десяти выбранных OSM-платформах;
- тестовые прогнозы из локального JSON;
- поиск по названию остановки;
- определение местоположения пользователя;
- отметка прибытия автобуса и прохождения остановок;
- локальная история событий со статусом `pending`;
- восстановление активной поездки после перезапуска;
- один нижний sheet для всего пользовательского сценария;
- PWA-манифест, service worker и кэш открытых тайлов карты;
- сборка, тесты и публикация в GitHub Pages через Actions.

Маршрут 3К и прогнозы помечены как тестовые. События никуда не отправляются и остаются в
IndexedDB до подключения backend-синхронизации.

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
├── route-stops.json
└── mock-forecasts.json
```

`stops.geojson` сформирован из OpenStreetMap для административной границы городского округа
Волгодонск. Исходные данные распространяются по лицензии ODbL 1.0. Команда преобразования
результата Overpass API:

```bash
node scripts/convert-overpass-stops.mjs overpass.json public/data/stops.geojson
```

## Локальное хранение

IndexedDB `ostanobus` содержит:

- `events` — прибытия и прохождения остановок со статусом `pending`;
- `activeRide` — единственная текущая поездка;
- `settings` — локальный идентификатор клиента и будущие настройки.

## GitHub Pages

Workflow `.github/workflows/deploy-pages.yml` собирает проект на `main` и публикует папку `dist`.
В настройках репозитория нужно выбрать **Settings → Pages → Source: GitHub Actions**.

Vite настроен на базовый путь `/Ostanobus/`, а маршрутизация использует hash history, поэтому
прямое открытие экранов работает на GitHub Pages.

## Стек

Vue 3, Vite, TypeScript, shadcn-vue, Tailwind CSS, Vue Router, Pinia, MapLibre GL JS, Dexie,
vite-plugin-pwa, Workbox, Vitest, ESLint и Prettier.
