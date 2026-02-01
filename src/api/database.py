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
                result['widget_settings'] = json.dumps(widget_settings)
                result['search_settings'] = json.dumps(search_settings)
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
            if result.get('widget_settings'):
                result['widget_settings'] = json.dumps(result['widget_settings'])
            if result.get('search_settings'):
                result['search_settings'] = json.dumps(result['search_settings'])
            if result.get('synonyms'):
                result['synonyms'] = result['synonyms']  # JSONB уже dict/list
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
            if result.get('widget_settings'):
                result['widget_settings'] = json.dumps(result['widget_settings'])
            if result.get('search_settings'):
                result['search_settings'] = json.dumps(result['search_settings'])
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
                if project.get('widget_settings'):
                    project['widget_settings'] = json.dumps(project['widget_settings'])
                if project.get('search_settings'):
                    project['search_settings'] = json.dumps(project['search_settings'])
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


# Глобальный экземпляр базы данных
db = Database()
