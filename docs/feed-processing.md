# Обработка фидов

> Сверено с `src/feed/parser.py`, `src/feed/scheduler.py`, `src/api/main.py` (`background_feed_load`), `src/search/indexer_simple.py`. Предыдущая версия этого файла описывала обобщённый multi-format пайплайн (`FullFeedProcessor`/`DeltaFeedProcessor` с поддержкой XML/JSON/CSV, Google Merchant, delta-фидов) — это код, который **существует** в `src/feed/processor.py`, но **не используется** реальным приложением. Ниже — то, что реально выполняется в проде.

## Что реально работает: `src/feed/parser.py` + `main.py`

Один тип фида — полный YML (Яндекс.Маркет), никакого отдельного delta-режима, никакого выбора формата. `FeedParser.parse_yml` ожидает конкретно YML-структуру (`<offer>` с `name`/`price`/`vendor`/`param` и т.п.) — Google Merchant, JSON и CSV не парсятся, несмотря на то что `src/feed/processor.py` и упомянутый в старой версии `FIELD_MAPPINGS` это предполагают.

```
POST /projects/{id}/feed/load
        │
        ▼
main.py: load_feed()
  - проверка, что для этого project_id ещё нет активной задачи (feed_loading_tasks dict)
  - сохраняет feed_url в проект (PostgreSQL)
  - asyncio.create_task(background_feed_load(...))  ← не блокирует HTTP-ответ
        │
        ▼
background_feed_load(project_id, feed_url)
  1. redis: project:{id}:feed.status = "downloading"
  2. FeedManager.load_feed()
       → FeedParser.fetch_feed()   - aiohttp, таймаут 300s, весь ответ в память как text()
       → FeedParser.parse_yml()    - ET.fromstring на ПОЛНЫЙ документ (не streaming),
                                      выполняется в отдельном потоке через asyncio.to_thread
  3. redis: status = "indexing"
  4. data_store.save_products()    - пишет в project:{id}:product:* (для вкладки "Товары")
  5. indexer.index_products()      - строит поисковый индекс (products:{id}:*, idx:{id}:*),
                                      CPU-часть (токенизация) вынесена в отдельный поток
  6. redis: status = "success", products_count, categories_count, last_update
```

Статус можно опрашивать через `GET /projects/{id}/feed/status` — дашборд поллит его раз в 2 секунды (см. `src/web/dashboard.js`).

### Почему шаги 2 и 5 идут через `asyncio.to_thread`

Приложение — один процесс с одним `uvicorn`-воркером на один event loop (см. [architecture.md](architecture.md)). `ET.fromstring()` на большом XML и построение инвертированного/n-gram/suggest индекса для тысяч товаров — синхронный, CPU-bound код на чистом Python. Если выполнить его прямо в корутине, GIL и event loop полностью заняты на всё время обработки, и сервер перестаёт отвечать на **любые** другие запросы — поиск с других сайтов, логин в дашборд, health-check у nginx. Вынос в `asyncio.to_thread` не даёт настоящего параллелизма (GIL никуда не делся), но позволяет event loop'у периодически перехватывать управление между переключениями GIL и обслуживать другие запросы, а не блокироваться полностью.

### Дублирование данных при загрузке

Шаги 4 и 5 пишут в **разные** Redis-неймспейсы независимо друг от друга (`project:{id}:product:*` vs `products:{id}:*`) — см. [database.md](database.md#redis--индексы-кэш-аналитика). Если один из вызовов упадёт после другого, вкладка "Товары" в дашборде и реальный поисковый индекс разойдутся.

## Автообновление (`src/feed/scheduler.py`)

Простой polling-цикл внутри того же процесса, не cron и не отдельный воркер:

- Каждые **15 минут** (`CHECK_INTERVAL_MINUTES`) сканирует все `project:proj_*` ключи в Redis (блокирующий `KEYS`, не `SCAN` — на проекте с большим количеством ключей это может подвесить Redis на короткое время каждые 15 минут).
- Для каждого проекта с `feed_url` и без `auto_update=false`: если фид не обновлялся дольше **4 часов** (`UPDATE_INTERVAL_HOURS`) — запускает тот же пайплайн, что и ручная загрузка (шаги 2–6 выше), включая CPU-тяжёлую индексацию (без выноса в поток — здесь эта проблема пока не исправлена).
- Нет приоритетов, нет очереди, нет ограничения на количество одновременных обновлений — если у пользователя истёк срок сразу у нескольких проектов, все они обрабатываются последовательно в одном цикле планировщика.

## Чего нет (в отличие от старой версии этого документа)

- Delta-фидов (остатки/цены отдельным лёгким фидом) — нет. Любое обновление, ручное или автоматическое, — это полная передозагрузка и полная переиндексация.
- Стриминг-парсинга (`ET.iterparse`) для экономии памяти — `parser.py` использует `ET.fromstring()` на весь документ целиком. (Иронично, что этот подход как раз описан в старой версии файла и реализован в неиспользуемом `src/feed/processor.py`.)
- Поддержки Google Merchant / JSON / CSV фидов в реальном пайплайне.
- Отдельной таблицы `feed_logs` с историей запусков — есть только текущий статус в Redis-хэше `project:{id}:feed`, история не хранится.
- Приоритетной очереди планировщика, вебхуков `feed.completed`/`feed.failed`, алертов о "protein drop" в количестве товаров.

Если что-то из этого понадобится, ближайшая отправная точка — уже написанный, но не подключенный `src/feed/processor.py` (класс `FeedProcessor`, поддерживает YML/Google/JSON/CSV через `FIELD_MAPPINGS`, стриминговый XML-парсинг, отдельно `process_delta_feed`).
