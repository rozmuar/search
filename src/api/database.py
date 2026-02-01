"""
PostgreSQL Database - надежное хранение пользователей, проектов, API ключей
"""
import asyncpg
from typing import Optional, List, Dict, Any
from datetime import datetime
import json
import os


class Database:
    """PostgreSQL подключение и операции"""
    
    def __init__(self):
        self.pool: Optional[asyncpg.Pool] = None
    
    async def connect(self):
        """Создание пула подключений"""
        self.pool = await asyncpg.create_pool(
            host=os.getenv("POSTGRES_HOST", "localhost"),
            port=int(os.getenv("POSTGRES_PORT", 5432)),
            user=os.getenv("POSTGRES_USER", "search"),
            password=os.getenv("POSTGRES_PASSWORD", "searchpro_secret_2024"),
            database=os.getenv("POSTGRES_DB", "search_service"),
            min_size=2,
            max_size=10
        )
        # Создаем таблицы если не существуют
        await self._init_tables()
    
    async def disconnect(self):
        """Закрытие пула подключений"""
        if self.pool:
            await self.pool.close()
    
    async def _init_tables(self):
        """Создание таблиц при первом запуске"""
        async with self.pool.acquire() as conn:
            await conn.execute('''
                CREATE TABLE IF NOT EXISTS users (
                    id VARCHAR(32) PRIMARY KEY,
                    email VARCHAR(255) UNIQUE NOT NULL,
                    name VARCHAR(255) NOT NULL,
                    password_hash VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                
                CREATE TABLE IF NOT EXISTS projects (
                    id VARCHAR(32) PRIMARY KEY,
                    user_id VARCHAR(32) REFERENCES users(id) ON DELETE CASCADE,
                    name VARCHAR(255) NOT NULL,
                    domain VARCHAR(255),
                    feed_url TEXT,
                    status VARCHAR(20) DEFAULT 'active',
                    products_count INTEGER DEFAULT 0,
                    widget_settings JSONB DEFAULT '{}',
                    search_settings JSONB DEFAULT '{}',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                
                CREATE TABLE IF NOT EXISTS api_keys (
                    key VARCHAR(64) PRIMARY KEY,
                    project_id VARCHAR(32) REFERENCES projects(id) ON DELETE CASCADE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                
                CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
                CREATE INDEX IF NOT EXISTS idx_api_keys_project_id ON api_keys(project_id);
            ''')
            
            # Миграция: добавляем search_settings если не существует
            await conn.execute('''
                DO $$ 
                BEGIN 
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                                   WHERE table_name='projects' AND column_name='search_settings') THEN
                        ALTER TABLE projects ADD COLUMN search_settings JSONB DEFAULT '{}';
                    END IF;
                END $$;
            ''')
            
            # Миграция: добавляем synonyms если не существует
            await conn.execute('''
                DO $$ 
                BEGIN 
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                                   WHERE table_name='projects' AND column_name='synonyms') THEN
                        ALTER TABLE projects ADD COLUMN synonyms JSONB DEFAULT '[]';
                    END IF;
                END $$;
            ''')
            
            # Таблица для хранения товаров (бэкап из Redis)
            await conn.execute('''
                CREATE TABLE IF NOT EXISTS products (
                    id SERIAL PRIMARY KEY,
                    project_id VARCHAR(32) REFERENCES projects(id) ON DELETE CASCADE,
                    product_id VARCHAR(255) NOT NULL,
                    data JSONB NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(project_id, product_id)
                );
                
                CREATE INDEX IF NOT EXISTS idx_products_project_id ON products(project_id);
            ''')
            
            # Таблицы для аналитики
            await conn.execute('''
                -- Ежедневная статистика
                CREATE TABLE IF NOT EXISTS analytics_daily (
                    id SERIAL PRIMARY KEY,
                    project_id VARCHAR(32) REFERENCES projects(id) ON DELETE CASCADE,
                    date DATE NOT NULL,
                    queries_count INTEGER DEFAULT 0,
                    clicks_count INTEGER DEFAULT 0,
                    UNIQUE(project_id, date)
                );
                
                CREATE INDEX IF NOT EXISTS idx_analytics_daily_project_date ON analytics_daily(project_id, date);
                
                -- Общие счётчики
                CREATE TABLE IF NOT EXISTS analytics_totals (
                    project_id VARCHAR(32) PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
                    total_queries BIGINT DEFAULT 0,
                    total_clicks BIGINT DEFAULT 0,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                
                -- Популярные запросы
                CREATE TABLE IF NOT EXISTS analytics_popular_queries (
                    id SERIAL PRIMARY KEY,
                    project_id VARCHAR(32) REFERENCES projects(id) ON DELETE CASCADE,
                    query TEXT NOT NULL,
                    count INTEGER DEFAULT 0,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(project_id, query)
                );
                
                CREATE INDEX IF NOT EXISTS idx_analytics_popular_queries_project ON analytics_popular_queries(project_id);
                
                -- Популярные товары (по кликам)
                CREATE TABLE IF NOT EXISTS analytics_popular_products (
                    id SERIAL PRIMARY KEY,
                    project_id VARCHAR(32) REFERENCES projects(id) ON DELETE CASCADE,
                    product_id VARCHAR(255) NOT NULL,
                    clicks INTEGER DEFAULT 0,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(project_id, product_id)
                );
                
                CREATE INDEX IF NOT EXISTS idx_analytics_popular_products_project ON analytics_popular_products(project_id);
                
                -- Конвертирующие запросы (запросы с кликами)
                CREATE TABLE IF NOT EXISTS analytics_converting_queries (
                    id SERIAL PRIMARY KEY,
                    project_id VARCHAR(32) REFERENCES projects(id) ON DELETE CASCADE,
                    query TEXT NOT NULL,
                    clicks INTEGER DEFAULT 0,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(project_id, query)
                );
                
                CREATE INDEX IF NOT EXISTS idx_analytics_converting_queries_project ON analytics_converting_queries(project_id);
            ''')
    
    # ========== USERS ==========
    
    async def create_user(self, user_id: str, email: str, name: str, password_hash: str) -> Optional[Dict]:
        """Создание пользователя"""
        try:
            async with self.pool.acquire() as conn:
                row = await conn.fetchrow('''
                    INSERT INTO users (id, email, name, password_hash)
                    VALUES ($1, $2, $3, $4)
                    RETURNING id, email, name, created_at
                ''', user_id, email, name, password_hash)
                return dict(row) if row else None
        except asyncpg.UniqueViolationError:
            return None  # Email уже существует
    
    async def get_user_by_email(self, email: str) -> Optional[Dict]:
        """Получить пользователя по email"""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow('''
                SELECT id, email, name, password_hash, created_at
                FROM users WHERE email = $1
            ''', email)
            return dict(row) if row else None
    
    async def get_user_by_id(self, user_id: str) -> Optional[Dict]:
        """Получить пользователя по ID"""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow('''
                SELECT id, email, name, created_at
                FROM users WHERE id = $1
            ''', user_id)
            return dict(row) if row else None
    
    # ========== PROJECTS ==========
    
    async def create_project(self, project_id: str, user_id: str, name: str, 
                            domain: str, feed_url: str = "", api_key: str = "") -> Dict:
        """Создание проекта"""
        widget_settings = {
            "theme": "light",
            "primaryColor": "#2563eb",
            "borderRadius": 8,
            "showImages": True,
            "showPrices": True,
            "placeholder": "Поиск товаров...",
            "maxResults": 10
        }
        
        search_settings = {
            "relatedProductsField": None,  # Поле для связанных товаров (brand, category, или параметр из фида)
            "relatedProductsLimit": 4,      # Количество связанных товаров
            "boostFields": ["brand", "category"]  # Поля для повышения релевантности
        }
        
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                # Создаем проект
                row = await conn.fetchrow('''
                    INSERT INTO projects (id, user_id, name, domain, feed_url, widget_settings, search_settings)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    RETURNING id, user_id, name, domain, feed_url, status, products_count, 
                              widget_settings, search_settings, created_at
                ''', project_id, user_id, name, domain, feed_url, json.dumps(widget_settings), json.dumps(search_settings))
                
                # Создаем API ключ
                await conn.execute('''
                    INSERT INTO api_keys (key, project_id) VALUES ($1, $2)
                ''', api_key, project_id)
                
                result = dict(row)
                result['api_key'] = api_key
                # widget_settings и search_settings уже dict из RETURNING
                return result
    
    async def get_project(self, project_id: str) -> Optional[Dict]:
        """Получить проект по ID"""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow('''
                SELECT p.id, p.user_id, p.name, p.domain, p.feed_url, p.status,
                       p.products_count, p.widget_settings, p.search_settings, p.synonyms, p.created_at, a.key as api_key
                FROM projects p
                LEFT JOIN api_keys a ON a.project_id = p.id
                WHERE p.id = $1
            ''', project_id)
            if not row:
                return None
            result = dict(row)
            # JSONB поля уже приходят как dict/list из PostgreSQL, не нужно сериализовать
            return result
    
    async def get_project_by_api_key(self, api_key: str) -> Optional[Dict]:
        """Получить проект по API ключу"""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow('''
                SELECT p.id, p.user_id, p.name, p.domain, p.feed_url, p.status,
                       p.products_count, p.widget_settings, p.search_settings, p.synonyms, p.created_at, a.key as api_key
                FROM api_keys a
                JOIN projects p ON p.id = a.project_id
                WHERE a.key = $1
            ''', api_key)
            if not row:
                return None
            result = dict(row)
            # JSONB поля уже приходят как dict/list из PostgreSQL
            return result
    
    async def get_user_projects(self, user_id: str) -> List[Dict]:
        """Получить все проекты пользователя"""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch('''
                SELECT p.id, p.user_id, p.name, p.domain, p.feed_url, p.status,
                       p.products_count, p.widget_settings, p.search_settings, p.created_at, a.key as api_key
                FROM projects p
                LEFT JOIN api_keys a ON a.project_id = p.id
                WHERE p.user_id = $1
                ORDER BY p.created_at DESC
            ''', user_id)
            
            result = []
            for row in rows:
                project = dict(row)
                # JSONB поля уже приходят как dict/list из PostgreSQL
                result.append(project)
            return result
    
    async def update_project(self, project_id: str, updates: Dict[str, Any]) -> Optional[Dict]:
        """Обновление проекта"""
        # Фильтруем разрешенные поля
        allowed_fields = ['name', 'domain', 'feed_url', 'status', 'products_count', 'widget_settings', 'search_settings', 'synonyms']
        filtered = {k: v for k, v in updates.items() if k in allowed_fields}
        
        if not filtered:
            return await self.get_project(project_id)
        
        # Строим динамический запрос
        set_parts = []
        values = []
        for i, (key, value) in enumerate(filtered.items(), 1):
            set_parts.append(f"{key} = ${i}")
            # Для JSONB полей конвертируем dict/list в JSON строку
            if key in ('widget_settings', 'search_settings', 'synonyms'):
                if isinstance(value, (dict, list)):
                    values.append(json.dumps(value))
                elif isinstance(value, str):
                    values.append(value)
                else:
                    values.append(json.dumps({} if key != 'synonyms' else []))
            else:
                values.append(value)
        
        values.append(project_id)
        
        async with self.pool.acquire() as conn:
            await conn.execute(f'''
                UPDATE projects SET {", ".join(set_parts)}
                WHERE id = ${len(values)}
            ''', *values)
        
        return await self.get_project(project_id)
    
    async def delete_project(self, project_id: str, user_id: str) -> bool:
        """Удаление проекта"""
        async with self.pool.acquire() as conn:
            result = await conn.execute('''
                DELETE FROM projects WHERE id = $1 AND user_id = $2
            ''', project_id, user_id)
            return result == "DELETE 1"
    
    async def regenerate_api_key(self, project_id: str, new_key: str) -> Optional[str]:
        """Перегенерация API ключа"""
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                # Удаляем старый ключ
                await conn.execute('''
                    DELETE FROM api_keys WHERE project_id = $1
                ''', project_id)
                
                # Создаем новый
                await conn.execute('''
                    INSERT INTO api_keys (key, project_id) VALUES ($1, $2)
                ''', new_key, project_id)
                
                return new_key
    
    async def update_products_count(self, project_id: str, count: int):
        """Обновить количество товаров"""
        async with self.pool.acquire() as conn:
            await conn.execute('''
                UPDATE projects SET products_count = $1 WHERE id = $2
            ''', count, project_id)
    
    # ========== PRODUCTS BACKUP ==========
    
    async def save_products_backup(self, project_id: str, products: List[Dict]) -> int:
        """Сохранение товаров в PostgreSQL (бэкап)"""
        if not products:
            return 0
        
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                # Удаляем старые товары проекта
                await conn.execute('''
                    DELETE FROM products WHERE project_id = $1
                ''', project_id)
                
                # Вставляем новые товары батчами
                batch_size = 1000
                for i in range(0, len(products), batch_size):
                    batch = products[i:i + batch_size]
                    values = [(project_id, p.get('id', ''), json.dumps(p)) for p in batch]
                    
                    await conn.executemany('''
                        INSERT INTO products (project_id, product_id, data)
                        VALUES ($1, $2, $3)
                        ON CONFLICT (project_id, product_id) DO UPDATE SET data = $3
                    ''', values)
        
        return len(products)
    
    async def get_products_backup(self, project_id: str) -> List[Dict]:
        """Получение товаров из PostgreSQL"""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch('''
                SELECT data FROM products WHERE project_id = $1
            ''', project_id)
            
            products = []
            for row in rows:
                data = row['data']
                if isinstance(data, str):
                    products.append(json.loads(data))
                else:
                    products.append(data)
            
            return products
    
    async def get_products_count_backup(self, project_id: str) -> int:
        """Количество товаров в PostgreSQL"""
        async with self.pool.acquire() as conn:
            result = await conn.fetchval('''
                SELECT COUNT(*) FROM products WHERE project_id = $1
            ''', project_id)
            return result or 0
    
    # ========== ANALYTICS BACKUP ==========
    
    async def increment_daily_queries(self, project_id: str, date: str, count: int = 1):
        """Увеличить счётчик запросов за день"""
        async with self.pool.acquire() as conn:
            await conn.execute('''
                INSERT INTO analytics_daily (project_id, date, queries_count)
                VALUES ($1, $2, $3)
                ON CONFLICT (project_id, date) 
                DO UPDATE SET queries_count = analytics_daily.queries_count + $3
            ''', project_id, date, count)
    
    async def increment_daily_clicks(self, project_id: str, date: str, count: int = 1):
        """Увеличить счётчик кликов за день"""
        async with self.pool.acquire() as conn:
            await conn.execute('''
                INSERT INTO analytics_daily (project_id, date, clicks_count)
                VALUES ($1, $2, $3)
                ON CONFLICT (project_id, date) 
                DO UPDATE SET clicks_count = analytics_daily.clicks_count + $3
            ''', project_id, date, count)
    
    async def increment_total_queries(self, project_id: str, count: int = 1):
        """Увеличить общий счётчик запросов"""
        async with self.pool.acquire() as conn:
            await conn.execute('''
                INSERT INTO analytics_totals (project_id, total_queries, updated_at)
                VALUES ($1, $2, CURRENT_TIMESTAMP)
                ON CONFLICT (project_id) 
                DO UPDATE SET total_queries = analytics_totals.total_queries + $2,
                              updated_at = CURRENT_TIMESTAMP
            ''', project_id, count)
    
    async def increment_total_clicks(self, project_id: str, count: int = 1):
        """Увеличить общий счётчик кликов"""
        async with self.pool.acquire() as conn:
            await conn.execute('''
                INSERT INTO analytics_totals (project_id, total_clicks, updated_at)
                VALUES ($1, $2, CURRENT_TIMESTAMP)
                ON CONFLICT (project_id) 
                DO UPDATE SET total_clicks = analytics_totals.total_clicks + $2,
                              updated_at = CURRENT_TIMESTAMP
            ''', project_id, count)
    
    async def increment_popular_query(self, project_id: str, query: str, count: int = 1):
        """Увеличить счётчик популярного запроса"""
        async with self.pool.acquire() as conn:
            await conn.execute('''
                INSERT INTO analytics_popular_queries (project_id, query, count, updated_at)
                VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
                ON CONFLICT (project_id, query) 
                DO UPDATE SET count = analytics_popular_queries.count + $3,
                              updated_at = CURRENT_TIMESTAMP
            ''', project_id, query, count)
    
    async def increment_popular_product(self, project_id: str, product_id: str, clicks: int = 1):
        """Увеличить счётчик кликов по товару"""
        async with self.pool.acquire() as conn:
            await conn.execute('''
                INSERT INTO analytics_popular_products (project_id, product_id, clicks, updated_at)
                VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
                ON CONFLICT (project_id, product_id) 
                DO UPDATE SET clicks = analytics_popular_products.clicks + $3,
                              updated_at = CURRENT_TIMESTAMP
            ''', project_id, product_id, clicks)
    
    async def increment_converting_query(self, project_id: str, query: str, clicks: int = 1):
        """Увеличить счётчик конвертирующего запроса"""
        async with self.pool.acquire() as conn:
            await conn.execute('''
                INSERT INTO analytics_converting_queries (project_id, query, clicks, updated_at)
                VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
                ON CONFLICT (project_id, query) 
                DO UPDATE SET clicks = analytics_converting_queries.clicks + $3,
                              updated_at = CURRENT_TIMESTAMP
            ''', project_id, query, clicks)
    
    async def get_analytics_backup(self, project_id: str, days: int = 7) -> Dict[str, Any]:
        """Получение аналитики из PostgreSQL"""
        async with self.pool.acquire() as conn:
            # Общие счётчики
            totals = await conn.fetchrow('''
                SELECT total_queries, total_clicks FROM analytics_totals WHERE project_id = $1
            ''', project_id)
            
            total_queries = totals['total_queries'] if totals else 0
            total_clicks = totals['total_clicks'] if totals else 0
            
            # Статистика по дням
            if days > 0:
                daily_rows = await conn.fetch('''
                    SELECT date, queries_count, clicks_count 
                    FROM analytics_daily 
                    WHERE project_id = $1 AND date >= CURRENT_DATE - $2::INTEGER
                    ORDER BY date DESC
                ''', project_id, days)
            else:
                daily_rows = await conn.fetch('''
                    SELECT date, queries_count, clicks_count 
                    FROM analytics_daily 
                    WHERE project_id = $1
                    ORDER BY date DESC
                ''', project_id)
            
            queries_by_day = {}
            clicks_by_day = {}
            for row in daily_rows:
                day_str = row['date'].strftime('%Y-%m-%d')
                queries_by_day[day_str] = row['queries_count']
                clicks_by_day[day_str] = row['clicks_count']
            
            # Популярные запросы
            popular_queries = await conn.fetch('''
                SELECT query, count FROM analytics_popular_queries 
                WHERE project_id = $1 ORDER BY count DESC LIMIT 20
            ''', project_id)
            
            # Популярные товары
            popular_products = await conn.fetch('''
                SELECT product_id, clicks FROM analytics_popular_products 
                WHERE project_id = $1 ORDER BY clicks DESC LIMIT 20
            ''', project_id)
            
            # Конвертирующие запросы
            converting_queries = await conn.fetch('''
                SELECT query, clicks FROM analytics_converting_queries 
                WHERE project_id = $1 ORDER BY clicks DESC LIMIT 10
            ''', project_id)
            
            return {
                "total_queries": total_queries,
                "total_clicks": total_clicks,
                "queries_by_day": queries_by_day,
                "clicks_by_day": clicks_by_day,
                "popular_queries": [{"query": r['query'], "count": r['count']} for r in popular_queries],
                "popular_products": [{"product_id": r['product_id'], "clicks": r['clicks']} for r in popular_products],
                "converting_queries": [{"query": r['query'], "clicks": r['clicks']} for r in converting_queries]
            }
    
    async def restore_analytics_to_redis(self, project_id: str, redis_client) -> bool:
        """Восстановление аналитики из PostgreSQL в Redis"""
        try:
            analytics = await self.get_analytics_backup(project_id, days=0)
            
            pipe = redis_client.pipeline()
            
            # Общие счётчики
            if analytics['total_queries']:
                pipe.set(f"analytics:{project_id}:total_queries", analytics['total_queries'])
            if analytics['total_clicks']:
                pipe.set(f"analytics:{project_id}:total_clicks", analytics['total_clicks'])
            
            # Ежедневная статистика
            for day, count in analytics['queries_by_day'].items():
                pipe.set(f"analytics:{project_id}:queries:{day}", count)
                pipe.expire(f"analytics:{project_id}:queries:{day}", 86400 * 365)
            
            for day, count in analytics['clicks_by_day'].items():
                pipe.set(f"analytics:{project_id}:clicks:{day}", count)
                pipe.expire(f"analytics:{project_id}:clicks:{day}", 86400 * 365)
            
            # Популярные запросы
            for q in analytics['popular_queries']:
                pipe.zadd(f"analytics:{project_id}:popular_queries", {q['query']: q['count']})
            
            # Популярные товары
            for p in analytics['popular_products']:
                pipe.zadd(f"analytics:{project_id}:popular_products", {p['product_id']: p['clicks']})
            
            # Конвертирующие запросы
            for q in analytics['converting_queries']:
                pipe.zadd(f"analytics:{project_id}:converting_queries", {q['query']: q['clicks']})
            
            await pipe.execute()
            return True
            
        except Exception as e:
            print(f"Failed to restore analytics: {e}")
            return False


# Глобальный экземпляр базы данных
db = Database()
