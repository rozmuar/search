# База данных

> Сверено с реальным кодом (`src/api/database.py`, `src/api/storage.py`, `src/search/indexer_simple.py`) по состоянию на текущую ветку `main`. Предыдущая версия этого файла описывала гипотетическую схему (UUID-ключи, таблицы `feeds`/`search_stats`), не совпадающую с тем, что реально создаётся в БД.

## PostgreSQL — пользователи, проекты, бэкап

Таблицы создаются автоматически при старте приложения в `Database._init_tables()` (`src/api/database.py`), включая `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`-миграции для старых окружений. Отдельного файла миграций нет.

```sql
-- Пользователи
CREATE TABLE users (
    id VARCHAR(32) PRIMARY KEY,             -- "user_<16 hex>"
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,     -- sha256(password + статичная соль), см. src/api/auth.py
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Проекты (сайты клиентов)
CREATE TABLE projects (
    id VARCHAR(32) PRIMARY KEY,             -- "proj_<16 hex>"
    user_id VARCHAR(32) REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    domain VARCHAR(255),
    feed_url TEXT,
    status VARCHAR(20) DEFAULT 'active',
    products_count INTEGER DEFAULT 0,
    widget_settings JSONB DEFAULT '{}',
    search_settings JSONB DEFAULT '{}',      -- добавлено миграцией
    synonyms JSONB DEFAULT '[]',             -- добавлено миграцией
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- API-ключи проекта (1:1 с проектом на практике, но модель допускает произвольную связь)
CREATE TABLE api_keys (
    key VARCHAR(64) PRIMARY KEY,             -- "sk_<48 hex>"
    project_id VARCHAR(32) REFERENCES projects(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Бэкап товаров (источник восстановления Redis-индекса при холодном старте)
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    project_id VARCHAR(32) REFERENCES projects(id) ON DELETE CASCADE,
    product_id VARCHAR(255) NOT NULL,
    data JSONB NOT NULL,                     -- полный JSON товара
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, product_id)
);

-- Аналитика (бэкап того, что реально живёт и считается в Redis)
CREATE TABLE analytics_daily (
    id SERIAL PRIMARY KEY,
    project_id VARCHAR(32) REFERENCES projects(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    queries_count INTEGER DEFAULT 0,
    clicks_count INTEGER DEFAULT 0,
    UNIQUE(project_id, date)
);

CREATE TABLE analytics_totals (
    project_id VARCHAR(32) PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    total_queries BIGINT DEFAULT 0,
    total_clicks BIGINT DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE analytics_popular_queries (
    id SERIAL PRIMARY KEY,
    project_id VARCHAR(32) REFERENCES projects(id) ON DELETE CASCADE,
    query TEXT NOT NULL,
    count INTEGER DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, query)
);

CREATE TABLE analytics_popular_products (
    id SERIAL PRIMARY KEY,
    project_id VARCHAR(32) REFERENCES projects(id) ON DELETE CASCADE,
    product_id VARCHAR(255) NOT NULL,
    clicks INTEGER DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, product_id)
);

CREATE TABLE analytics_converting_queries (
    id SERIAL PRIMARY KEY,
    project_id VARCHAR(32) REFERENCES projects(id) ON DELETE CASCADE,
    query TEXT NOT NULL,
    clicks INTEGER DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, query)
);
```

**Чего нет** (в отличие от старой версии этого документа): таблиц `feeds`, `feed_logs`, `stopwords`, `search_stats`. Настройки фида — это просто поле `projects.feed_url` (один фид на проект, без истории обработки в БД); синонимы и стоп-слова живут как JSON-поля/в Redis, а не в отдельных таблицах.

## PostgreSQL — как используется

- Источник правды для `users`/`projects`/`api_keys` — Redis тут только кэш (`apikey:{key} -> project_id`, см. ниже).
- `products` — бэкап для восстановления после потери данных Redis. Перезаписывается целиком (`DELETE` + batched `INSERT`) при каждой полной индексации, см. [feed-processing.md](feed-processing.md).
- Таблицы `analytics_*` — бэкап Redis-счётчиков аналитики, восстанавливаются на старте, если в Redis для проекта нет ключей `analytics:{project_id}:*` (см. `restore_products_from_backup` в `src/api/main.py`).

## Redis — индексы, кэш, аналитика

⚠️ **Важная особенность, не очевидная из кода с первого взгляда:** товары для поиска и товары для дашборда хранятся в **двух разных, не связанных друг с другом местах**:

| Что | Ключ | Пишет | Читает |
|---|---|---|---|
| Товары для поиска/индекса | `products:{project_id}:{product_id}` | `SimpleIndexer.index_products()` | `SimpleSearchEngine` (поиск), `restore_products_from_backup` |
| Товары для вкладки "Товары" в дашборде | `project:{project_id}:product:{product_id}` + SET `project:{project_id}:product_ids` | `DataStore.save_products()` | `GET /api/v1/projects/{id}/products` |

Обе записи выполняются в одном и том же `background_feed_load()` (`src/api/main.py`), но независимо друг от друга — рассинхронизация здесь возможна (например, если один из вызовов упал посередине).

```
# ---- Поисковый индекс (SimpleIndexer / SimpleSearchEngine) ----

# Товар (JSON)
products:{project_id}:{product_id} = {
    id, name, description, url, image, price, old_price,
    in_stock, category, brand, vendor_code, params
}

# Инвертированный индекс: токен -> {product_id: score}
idx:{project_id}:inv:{token} = ZSET

# N-gram индекс (триграммы) для частичного совпадения: ngram -> {токены}
idx:{project_id}:ngram:{ngram} = SET

# Индекс подсказок: единый ZSET со всеми префиксами названий товаров
idx:{project_id}:suggest = ZSET {prefix: частота}

# ---- Дашборд / "Товары" ----

project:{project_id}:product:{product_id} = JSON товара
project:{project_id}:product_ids = SET {product_id, ...}
project:{project_id} = HASH {products_count, ...}

# ---- Фиды ----

project:{project_id}:feed = HASH {
    url, status (downloading|indexing|success|error|not_loaded),
    progress, message, products_count, categories_count,
    last_update, last_auto_update, auto_update_status
}

# ---- Аутентификация / проекты ----

apikey:{api_key} = project_id     # кэш перед PostgreSQL, см. DataStore.get_project_by_api_key

# ---- Синонимы ----

synonyms:{project_id} = JSON [[слово, синоним1, синоним2, ...], ...]   # кэш; источник правды - projects.synonyms в PostgreSQL

# ---- Аналитика (см. также analytics_* в PostgreSQL - это бэкап тех же чисел) ----

analytics:{project_id}:total_queries = INT
analytics:{project_id}:total_clicks = INT
analytics:{project_id}:queries:{YYYY-MM-DD} = INT           (TTL 365 дней)
analytics:{project_id}:clicks:{YYYY-MM-DD} = INT            (TTL 365 дней)
analytics:{project_id}:queries:hourly:{YYYY-MM-DD-HH} = INT (TTL 7 дней)
analytics:{project_id}:popular_queries = ZSET {query: count}
analytics:{project_id}:popular_products = ZSET {product_id: clicks}
analytics:{project_id}:converting_queries = ZSET {query: clicks}   # запросы, после которых был клик
analytics:{project_id}:response_times = LIST (последние 1000 значений took_ms)
```

**Чего нет** (в отличие от старой версии этого документа): кэша результатов поиска (`cache:{project_id}:search:*`), Elasticsearch-маппинга, блокировок `lock:feed:{feed_id}`. Кэширование поисковых запросов не реализовано — каждый `/api/v1/search` бьёт по индексу напрямую.

## Восстановление после потери Redis

При старте (`restore_products_from_backup` в `src/api/main.py`, выполняется в фоне, не блокируя приём запросов — см. [feed-processing.md](feed-processing.md)) для каждого проекта из PostgreSQL:

1. Если в Redis нет ключей `products:{project_id}:*` — полное восстановление товаров и индекса из таблицы `products` (`Indexer.restore_from_backup`).
2. Если товары есть, а индекса (`idx:{project_id}:inv:*`) нет — пересборка только индекса из уже лежащих в Redis товаров (`Indexer.rebuild_index_from_redis`), без обращения к PostgreSQL.
3. Если нет ключей `analytics:{project_id}:*` — восстановление счётчиков аналитики из `analytics_*`-таблиц.

Ключи `project:{project_id}:product:*` (дашборд-вкладка "Товары") этим восстановлением **не покрываются** — у них нет отдельного бэкапа в PostgreSQL.
