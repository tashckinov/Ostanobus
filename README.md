# Останобус

PWA-карта городского транспорта Волгодонска с локальными пассажирскими отметками,
вероятностными прогнозами и собственной административной панелью.

## Состав проекта

- `/` — мобильная Vue 3 PWA, публикуемая в GitHub Pages;
- `/backend` — Fastify API на TypeScript, TypeORM и SQLite;
- `/admin` — Vue 3 + MapLibre административная панель;
- `/public/data` — исходные остановки, маршрут 3К и начальные прогнозы;
- `docker-compose.yml` — backend и собранная admin-панель в одном контейнере с постоянным
  SQLite volume.

PWA загружает данные из API, когда он настроен и доступен. Без сети используются GeoJSON и JSON
из сборки. События остаются в IndexedDB со статусом `pending`, а после успешной пакетной отправки
получают статус `synced`. Повторная отправка UUID безопасна и возвращается сервером как
`duplicate`.

`activeRide` и `settings` остаются только на телефоне.

## Запуск backend и админки в Docker

```bash
cp .env.example .env
```

Перед запуском замените в `.env` значения `ADMIN_PASSWORD` и `JWT_SECRET`.

```bash
docker compose up -d --build
```

После запуска:

- API: `http://localhost:8080/api/v1/health`;
- админка: `http://localhost:8080/admin/`;
- логин по умолчанию: `admin@ostanobus.local`;
- данные SQLite: Docker volume `ostanobus-data`.

Остановить контейнер:

```bash
docker compose down
```

Команда не удаляет базу. Для полного удаления вместе с SQLite volume используется
`docker compose down -v`.

### Запуск только backend

В текущем пилоте admin-панель встроена в тот же Docker-образ, а Compose содержит один сервис
`backend`. Поэтому запустить только этот сервис можно так:

```bash
docker compose up -d --build backend
```

Это запускает Fastify API на порту `8080`; собранные статические файлы админки остаются доступны
по `/admin/`, отдельного процесса админки нет.

## Публичное API

| Метод  | URL                                      | Назначение                                        |
| ------ | ---------------------------------------- | ------------------------------------------------- |
| `GET`  | `/api/v1/health`                         | Состояние backend и БД                            |
| `GET`  | `/api/v1/stops`                          | Остановки в GeoJSON                               |
| `GET`  | `/api/v1/routes`                         | Маршруты, направления, порядок остановок и трассы |
| `GET`  | `/api/v1/stops/{id}/forecasts`           | Прогнозы для остановки                            |
| `POST` | `/api/v1/events/sync`                    | Пакетная синхронизация локальных событий          |
| `POST` | `/api/v1/support/tickets`                | Создание обращения                                |
| `GET`  | `/api/v1/support/tickets/{id}?token=...` | Статус и ответ поддержки                          |

Пример синхронизации:

```json
{
  "clientId": "anonymous-device-uuid",
  "events": [
    {
      "id": "event-uuid",
      "type": "bus_arrival",
      "routeId": "3k",
      "directionId": "3k-vzmeo-artemida",
      "stopId": "osm-node-9222336258",
      "occurredAt": "2026-07-25T20:30:00Z"
    }
  ]
}
```

Ответ:

```json
{
  "accepted": ["event-uuid"],
  "duplicates": [],
  "rejected": []
}
```

## Админка

После авторизации доступны:

- создание, перемещение и редактирование остановок на карте;
- создание маршрутов и любого количества направлений;
- установка порядка остановок отдельно для каждого направления;
- прокладка трассы по дорогам через OSRM и ручные промежуточные точки;
- точное расписание и интервалы движения;
- включение и отключение маршрутов, направлений и остановок;
- ручное ведение прогнозов;
- просмотр принятых пассажирских событий и простой сводной статистики;
- обработка обращений и публикация ответа пользователю.

SQLite автоматически создаётся при первом запуске и заполняется исходными данными из
`public/data`. Для пилота TypeORM синхронизирует схему автоматически. Перед переходом на
PostgreSQL/PostGIS нужно добавить версионируемые миграции и заменить геометрию маршрутов на
пространственные типы.

## GitHub Pages и адрес API

Workflow `.github/workflows/deploy-pages.yml` проверяет все три части проекта и публикует PWA из
`dist`. В репозитории выберите **Settings → Pages → Source: GitHub Actions**.

Добавьте в **Settings → Secrets and variables → Actions → Variables** переменную:

```text
API_BASE_URL=https://api.example.ru
```

Она попадает в PWA как `VITE_API_BASE_URL`. Backend для опубликованной PWA должен быть доступен
по HTTPS; его origin также нужно добавить в `CORS_ORIGINS`. TLS удобно завершать на Caddy или
Nginx перед контейнером.

## Локальная разработка

PWA:

```bash
npm ci
npm run dev
```

Backend:

```bash
npm ci --prefix backend
npm run dev --prefix backend
```

Admin:

```bash
npm ci --prefix admin
npm run dev --prefix admin
```

Vite admin работает на `http://localhost:5174` и проксирует `/api` в backend на порту `8080`.

Полная проверка:

```bash
npm run check
npm run check --prefix backend
npm run check --prefix admin
```

## Данные и лицензия

```text
public/data/
├── stops.geojson
├── route-stops.json
└── mock-forecasts.json
```

Остановки сформированы из OpenStreetMap для административной границы городского округа
Волгодонск. Исходные данные распространяются по лицензии ODbL 1.0.

```bash
node scripts/convert-overpass-stops.mjs overpass.json public/data/stops.geojson
```
