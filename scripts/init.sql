-- Инициализация базы данных PostgreSQL для SearchPro
-- Запускается автоматически при первом запуске контейнера

-- Таблица пользователей
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(32) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица проектов
CREATE TABLE IF NOT EXISTS projects (
    id VARCHAR(32) PRIMARY KEY,
    user_id VARCHAR(32) REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    domain VARCHAR(255),
    feed_url TEXT,
    status VARCHAR(20) DEFAULT 'active',
    products_count INTEGER DEFAULT 0,
    widget_settings JSONB DEFAULT '{"theme":"light","primaryColor":"#2563eb","borderRadius":8,"showImages":true,"showPrices":true,"placeholder":"Поиск товаров...","maxResults":10}',
    search_settings JSONB DEFAULT '{"relatedProductsField":null,"relatedProductsLimit":4,"boostFields":["brand","category"]}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Добавляем колонку search_settings если её нет (для существующих БД)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='projects' AND column_name='search_settings') THEN
        ALTER TABLE projects ADD COLUMN search_settings JSONB DEFAULT '{"relatedProductsField":null,"relatedProductsLimit":4,"boostFields":["brand","category"]}';
    END IF;
END $$;

-- Таблица API ключей
CREATE TABLE IF NOT EXISTS api_keys (
    key VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(32) REFERENCES projects(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_project_id ON api_keys(project_id);

-- Данные сохраняются в PostgreSQL:
--   - users (id, email, name, password_hash)
--   - projects (id, user_id, name, domain, feed_url, status, widget_settings)
--   - api_keys (key, project_id)
--
-- В Redis хранится:
--   - products:{project_id}:{product_id} - данные товаров
--   - idx:{project_id}:* - поисковые индексы
--   - analytics:{project_id}:* - аналитика

