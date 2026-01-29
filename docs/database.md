# База данных

## Схема PostgreSQL

```sql
-- Пользователи
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Проекты (сайты клиентов)
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    domain VARCHAR(255) NOT NULL,
    api_key VARCHAR(64) UNIQUE NOT NULL,
    settings JSONB DEFAULT '{}',
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Фиды
CREATE TABLE feeds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL, -- 'full' или 'delta'
    url TEXT NOT NULL,
    format VARCHAR(50) DEFAULT 'xml', -- xml, json, csv
    update_interval INTEGER DEFAULT 3600, -- секунды
    last_update TIMESTAMP,
    last_status VARCHAR(50),
    last_error TEXT,
    items_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- История обработки фидов
CREATE TABLE feed_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feed_id UUID REFERENCES feeds(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL,
    items_processed INTEGER DEFAULT 0,
    items_added INTEGER DEFAULT 0,
    items_updated INTEGER DEFAULT 0,
    items_deleted INTEGER DEFAULT 0,
    errors_count INTEGER DEFAULT 0,
    duration_ms INTEGER,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Синонимы
CREATE TABLE synonyms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    word VARCHAR(255) NOT NULL,
    synonyms TEXT[] NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Стоп-слова
CREATE TABLE stopwords (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    word VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Статистика поиска
CREATE TABLE search_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    query VARCHAR(500) NOT NULL,
    results_count INTEGER DEFAULT 0,
    clicked_product_id VARCHAR(255),
    click_position INTEGER,
    session_id VARCHAR(255),
    user_agent TEXT,
    ip_address INET,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Индексы
CREATE INDEX idx_projects_user_id ON projects(user_id);
CREATE INDEX idx_projects_api_key ON projects(api_key);
CREATE INDEX idx_feeds_project_id ON feeds(project_id);
CREATE INDEX idx_feeds_next_update ON feeds(last_update, update_interval);
CREATE INDEX idx_synonyms_project_id ON synonyms(project_id);
CREATE INDEX idx_search_stats_project_id ON search_stats(project_id);
CREATE INDEX idx_search_stats_created_at ON search_stats(created_at);
CREATE INDEX idx_search_stats_query ON search_stats(project_id, query);
```

## Структуры Redis

```
# Товары проекта (хранение)
products:{project_id}:{product_id} = JSON {
    id, name, description, url, image, price, 
    old_price, in_stock, quantity, category, 
    brand, attributes, discount_percent
}

# Инвертированный индекс (токен -> товары со скорами)
idx:{project_id}:inv:{token} = ZSET {
    product_id_1: 0.95,
    product_id_2: 0.82,
    ...
}

# N-gram индекс (для частичного совпадения)
idx:{project_id}:ngram:{ngram} = SET {
    token_1,
    token_2,
    ...
}

# Подсказки (префикс -> запросы)
idx:{project_id}:suggest:{prefix} = ZSET {
    "кроссовки": 1250,
    "кроссовки nike": 560,
    ...
}

# Кэш результатов поиска
cache:{project_id}:search:{query_hash} = JSON {
    results: [...],
    total: 156,
    cached_at: timestamp
}
TTL: 60-300 секунд

# Кэш подсказок
cache:{project_id}:suggest:{prefix_hash} = JSON {
    queries: [...],
    categories: [...],
    products: [...]
}
TTL: 30-60 секунд

# Обратный индекс (товар -> кэшированные запросы)
cache:products:{project_id}:{product_id} = SET {
    query_hash_1,
    query_hash_2,
    ...
}

# Популярные запросы (за период)
stats:{project_id}:queries:daily:{date} = ZSET {
    "кроссовки": 542,
    "nike": 321,
    ...
}

# Счётчики запросов
stats:{project_id}:total = {
    searches: 15420,
    suggestions: 45230,
    clicks: 3210
}

# Блокировка обработки фида
lock:feed:{feed_id} = "processing"
TTL: 300 секунд
```
