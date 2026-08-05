# API документация

> Сверено с `src/api/main.py` по текущей ветке `main`. Предыдущая версия описывала гипотетический API (UUID id, facets, webhooks, rate-limit тиры) — ничего из этого не реализовано. Здесь — то, что реально отвечает.

Базовый путь на проде: `https://<домен>/api/v1` (nginx проксирует `/api/` на `127.0.0.1:8000`, см. `nginx.conf`).

## Аутентификация

Два независимых механизма для двух разных групп эндпоинтов:

- **JWT** (личный кабинет/дашборд): `Authorization: Bearer <token>`, токен выдаётся `/auth/login` или `/auth/register`, живёт 7 дней (`ACCESS_TOKEN_EXPIRE_HOURS = 24*7` в `src/api/auth.py`). Требуется для всех `/api/v1/projects/...` эндпоинтов.
- **API-ключ проекта** (публичные поисковые эндпоинты, вызывает виджет с сайта клиента): заголовок `X-API-Key: <key>` или query-параметр `?api_key=<key>`. Ключ имеет вид `sk_<48 hex>`. Работает и без ключа — тогда используется demo-проект `project_id=demo` или явный `?project_id=`.

Ключи не имеют scope/тиров — это плоский bearer-секрет на проект, ротация через `POST /projects/{id}/regenerate-key`.

---

## Публичные поисковые эндпоинты (для виджета)

### `GET /api/v1/search`

| Параметр | Тип | Обязательный | Описание |
|---|---|---|---|
| `q` | string | да | поисковый запрос |
| `project_id` | string | нет | если не передан `api_key` |
| `api_key` / `X-API-Key` | string | нет | приоритет над `project_id` |
| `limit` | int | нет | 50 по умолчанию, `-1` = все (внутренне капается на 10000) |
| `min_price`, `max_price` | float | нет | фильтр по цене (для обратной совместимости — см. `filters` ниже) |
| `in_stock` | bool | нет | фильтр по наличию |
| `category` | string | нет | точное совпадение категории |
| `filters` | string (JSON) | нет | расширенные фильтры — множественный выбор по категории и по `params.*`, см. ниже |
| `facets` | bool | нет | `false` по умолчанию; если `true` — в ответе появляется `facets` для построения сайдбара фильтров |
| `sort` | string | нет | `relevance` (default) \| `price_asc` \| `price_desc` |

Нет `offset` в query — движок его поддерживает внутри (`SimpleSearchEngine.search`), но эндпоинт не пробрасывает наружу; пагинация по одной категории делается через `filters.category` + повторный запрос с тем же `limit`.

`filters` — JSON-объект, накладывается ПОВЕРХ старых `min_price`/`max_price`/`in_stock`/`category` (их можно не передавать, если используете `filters`). Значения внутри одного ключа объединяются через OR, разные ключи — через AND:
```json
{
  "min_price": 500, "max_price": 5000, "in_stock": true,
  "category": ["Моторные масла", "Трансмиссионные масла"],
  "params": { "Вязкость": ["5W-30"], "Вид фасовки": ["Канистра 4л"] }
}
```
Некорректный JSON в `filters` → `400 Bad Request`.

```json
{
  "items": [
    {
      "id": "SKU-12345",
      "name": "Кроссовки Nike Air Max 90",
      "url": "...", "image": "...",
      "price": 12990, "old_price": 15990,
      "in_stock": true, "category": "...", "brand": "Nike",
      "params": {}
    }
  ],
  "total": 156,
  "query": "кроссовки nike",
  "meta": { "took_ms": 12.3, "project_id": "proj_ab12cd34" },
  "related": [
    { "field": "brand", "value": "Nike", "items": [ /* товары */ ] }
  ],
  "facets": {
    "categories": [{"value": "Моторные масла", "count": 84}],
    "price": {"min": 320.0, "max": 24990.0},
    "params": {
      "Вязкость": [{"value": "5W-30", "count": 38}, {"value": "5W-40", "count": 22}]
    }
  }
}
```

`related` появляется только если в настройках проекта (`search_settings.relatedProductsFields`) задано поле для похожих товаров — см. `PUT /projects/{id}/search-settings`. `facets` появляется только при `facets=true` и непустом результате.

**Фасеты — как считаются** (`SimpleSearchEngine._apply_filters_and_facets`/`_build_facets_payload`): один проход по кандидатам, полученным из инвертированного индекса (не по всему каталогу). Счётчики (`categories`, `params.*`) — это "drill-down": считаются от уже полностью отфильтрованного набора, то есть выбор одного значения фасета может уменьшить/скрыть значения в других фасетах (честной "исключи текущий фасет из подсчёта" фасетизации нет — см. [search-algorithm.md](search-algorithm.md)). Единственное исключение — границы `price.min/max`, которые считаются без учёта фильтра по цене (иначе слайдер нельзя было бы раздвинуть обратно).

Какие `params.*` попадают в фасеты:
- **По умолчанию** — авто-определение по покрытию (≥5% отфильтрованных товаров) и не-уникальности (не более 80% уникальных значений на товар с этим параметром), так SKU-подобные параметры не превращаются в фасет из сотен чекбоксов. Максимум 8 групп, 20 значений в группе.
- **Если в `search_settings.facetFields` (см. `PUT /projects/{id}/search-settings`) задан непустой список** — эвристика полностью игнорируется, показываются РОВНО эти `params.*`-поля (по именам, без префикса `params.`) в заданном порядке. Пустой массив `[]` в `facetFields` означает "явно ноль фасетов по параметрам", а не "не настроено" — поэтому дашборд не отправляет ключ `facetFields` вовсе, если ни один чекбокс не отмечен (иначе первое же сохранение других настроек поиска тихо выключило бы автоопределение).

Каждый вызов пишет строку в аналитику (`DataStore.log_search`), если нормализованный запрос ≥ 2 символов.

### `GET /api/v1/suggest`

`q` (обяз.), `project_id`/`api_key`, `limit` (default 5). Возвращает не более 3 текстовых подсказок и товары по первой из них:

```json
{ "suggestions": {
  "queries": [{"text": "кроссовки", "highlight": "кроссовки"}],
  "categories": [],
  "products": [ /* до 8 товаров */ ]
}}
```

`categories` всегда пустой массив — категорийные подсказки не реализованы, несмотря на поле в ответе.

### `GET /api/v1/popular`

`project_id`/`api_key`, `limit` (default 5, max 10). Топ популярных запросов проекта за всё время (без разбивки по периоду, параметра `period` не существует):

```json
{ "queries": [{"text": "кроссовки", "count": 5420}] }
```

### `GET /api/v1/categories`

`project_id`/`api_key`. Список категорий проекта со счётчиками — источник данных для дропдауна "Везде ▾" в виджете (выбор категории *до* ввода запроса, когда фасетов из результатов поиска ещё нет). Полный `SCAN` по всем товарам проекта, поэтому результат кэшируется в Redis на 5 минут (`cache:categories:{project_id}`) и сбрасывается сразу при переиндексации фида (`SimpleIndexer.index_products`), так что свежий фид не ждёт до 5 минут.

```json
{
  "categories": [{"name": "Моторные масла", "count": 812}, {"name": "Трансмиссионные масла", "count": 140}],
  "total_products": 3400
}
```

### `GET /api/v1/widget/{api_key}/config`

Публичный конфиг виджета (без авторизации) — то, что сохранено через `PUT /projects/{id}/widget`.

### `GET /api/v1/widget/embed.js`

Отдаёт `src/web/embed.js`. На проде обычно не используется — nginx отдаёт тот же файл статикой напрямую по `/embed.js` (см. `nginx.conf`, `location = /embed.js`), это то, что дашборд показывает клиентам в коде для вставки. См. [widget-integration.md](widget-integration.md).

### `POST /api/v1/track/click`

```json
{ "api_key": "sk_...", "product_id": "SKU-12345", "query": "кроссовки" }
```
Логирует клик в аналитику. Без API-ключа — `{"success": false}` с 200, не 401/403.

### `POST /api/v1/analytics/event`

Принимает и **полностью игнорирует** любое тело — заглушка для будущей аналитики виджета.

---

## Аутентификация (личный кабинет)

### `POST /api/v1/auth/register`
`{ "email", "password", "name" }` → `Token` (`access_token`, `user`). `400` если email занят.

### `POST /api/v1/auth/login`
`{ "email", "password" }` → `Token`. `401` при неверных данных.

### `GET /api/v1/auth/me`
Требует `Authorization`. Возвращает текущего `User`.

---

## Проекты (требуют JWT, доступ только к своим проектам — проверка `project.user_id == user.id`, иначе `404`)

| Метод | Путь | Описание |
|---|---|---|
| GET | `/projects` | список проектов пользователя |
| POST | `/projects` | создать (`name`, `domain`, `feed_url?`) |
| GET | `/projects/{id}` | получить один |
| PUT | `/projects/{id}` | обновить (`name`/`domain`/`feed_url`/`widget_settings`) |
| DELETE | `/projects/{id}` | удалить + каскадная зачистка ключей Redis проекта |
| POST | `/projects/{id}/regenerate-key` | перегенерировать API-ключ |

## Фиды

| Метод | Путь | Описание |
|---|---|---|
| POST | `/projects/{id}/feed/load` | запустить фоновую загрузку (тело `{url?}`, иначе берётся `project.feed_url`). Не запускает вторую загрузку, если одна уже идёт для этого проекта |
| GET | `/projects/{id}/feed/status` | статус: `not_loaded`\|`downloading`\|`indexing`\|`success`\|`error`, поля `progress`, `message`, `products_count` |

Подробности пайплайна — [feed-processing.md](feed-processing.md).

## Товары и индекс

| Метод | Путь | Описание |
|---|---|---|
| GET | `/projects/{id}/products?limit=&offset=` | список товаров **из дашборд-хранилища** (`project:{id}:product:*`, не из поискового индекса — см. [database.md](database.md)) |
| GET | `/projects/{id}/index-stats` | диагностика поискового индекса: число товаров/токенов в Redis, примеры токенов. Авторизация по **API-ключу**, не JWT |
| GET | `/projects/{id}/feed-params` | список полей/`params.*`, найденных в первых 20 товарах — для настройки похожих товаров |

## Аналитика

### `GET /projects/{id}/analytics?days=7`

`days=0` — за всё время. Ответ:
```json
{
  "total_queries": 15420, "total_clicks": 3210,
  "queries_by_day": {"2026-08-04": 542}, "clicks_by_day": {"2026-08-04": 88},
  "popular_queries": [{"query": "кроссовки", "count": 542}],
  "popular_products": [{"product_id": "SKU-1", "clicks": 40}],
  "converting_queries": [{"query": "кроссовки", "clicks": 12}],
  "avg_response_time_ms": 23.4
}
```

## Настройки

| Метод | Путь | Описание |
|---|---|---|
| GET/PUT | `/projects/{id}/widget` | тема, цвета, показ картинок/цен, `cartCallbackUrl` и т.д. — произвольный JSON, без строгой схемы на бэкенде |
| GET/PUT | `/projects/{id}/search-settings` | `relatedProductsFields: string[]`, `relatedProductsLimit`, `boostFields`, `facetFields: string[]` |
| GET/PUT | `/projects/{id}/synonyms` | `{"synonyms": [["масло","смазка","oil"], ...]}` — список групп, не пары "слово → синонимы" |

## Служебное

- `GET /health` — `{"status": "healthy", "redis": "connected"}` или `503` с `"disconnected"`. Проверяет только Redis, не PostgreSQL.
- `GET /` — `{"service", "version", "docs"}`.
- `GET /docs`, `/openapi.json` — стандартный Swagger/OpenAPI от FastAPI.

## Чего нет (в отличие от старой версии этого документа)

Нет: `/api/v1/products/{id}`, `/api/v1/products/{id}/similar`, `/api/v1/admin/*` эндпоинтов, webhooks (`feed.completed` и т.п.), rate-limit тиров и заголовков `X-RateLimit-*`, единого формата ошибок `{"success": false, "error": {...}}` (реально — стандартный FastAPI `{"detail": "..."}` с HTTP-кодом). `facets` в ответе `/search` есть (см. выше), но только при `facets=true`.
