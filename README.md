# Останобус

Мобильная PWA-карта остановок городского транспорта Волгодонска.

## Что работает

- карта на MapLibre GL JS и OpenStreetMap;
- 275 остановочных платформ из OpenStreetMap;
- поиск по названию остановки;
- определение местоположения пользователя;
- один нижний sheet для поиска и информации об остановке;
- PWA-манифест, service worker и кэш открытых тайлов карты;
- сборка, тесты и публикация в GitHub Pages через Actions.

Маршруты не отображаются, пока не проверены последовательность остановок и фактическая трасса.

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

`stops.geojson` сформирован из OpenStreetMap для административной границы городского округа
Волгодонск. Исходные данные распространяются по лицензии ODbL 1.0. Команда преобразования
результата Overpass API:

```bash
node scripts/convert-overpass-stops.mjs overpass.json public/data/stops.geojson
```

## GitHub Pages

Workflow `.github/workflows/deploy-pages.yml` собирает проект на `main` и публикует папку `dist`.
В настройках репозитория нужно выбрать **Settings → Pages → Source: GitHub Actions**.

Vite настроен на базовый путь `/Ostanobus/`, а маршрутизация использует hash history, поэтому
прямое открытие экранов работает на GitHub Pages.

## Стек

Vue 3, Vite, TypeScript, shadcn-vue, Tailwind CSS, Vue Router, Pinia, MapLibre GL JS, Dexie,
vite-plugin-pwa, Workbox, Vitest, ESLint и Prettier.
