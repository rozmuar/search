"""
Хранилище данных - пользователи, проекты, аналитика
PostgreSQL для надежного хранения users/projects
Redis для кэша, индексов и аналитики
"""
import json
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
import secrets

from .auth import (
    hash_password, verify_password, create_access_token,
    generate_user_id, generate_project_id, generate_api_key,
    User, UserCreate, UserLogin, Token
)
from .database import db


class DataStore:
    """Хранилище данных - PostgreSQL + Redis"""
    
    def __init__(self, redis_client):
        self.redis = redis_client
    
    # ========== USERS (PostgreSQL) ==========
    
    async def create_user(self, data: UserCreate) -> Optional[Token]:
        """Создание нового пользователя"""
        user_id = generate_user_id()
        password_hash = hash_password(data.password)
        
        user = await db.create_user(user_id, data.email, data.name, password_hash)
        if not user:
            return None  # Email уже занят
        
        # Создаем токен
        access_token = create_access_token(user_id, data.email)
        
        return Token(
            access_token=access_token,
            user=User(
                id=user_id,
                email=data.email,
                name=data.name,
                created_at=str(user["created_at"])
            )
        )
    
    async def login_user(self, data: UserLogin) -> Optional[Token]:
        """Авторизация пользователя"""
        user = await db.get_user_by_email(data.email)
        if not user:
            return None
        
        # Проверяем пароль
        if not verify_password(data.password, user["password_hash"]):
            return None
        
        # Создаем токен
        access_token = create_access_token(user["id"], data.email)
        
        return Token(
            access_token=access_token,
            user=User(
                id=user["id"],
                email=user["email"],
                name=user["name"],
                created_at=str(user["created_at"])
            )
        )
    
    async def get_user(self, user_id: str) -> Optional[User]:
        """Получение пользователя по ID"""
        user = await db.get_user_by_id(user_id)
        if not user:
            return None
        
        return User(
            id=user["id"],
            email=user["email"],
            name=user["name"],
            created_at=str(user["created_at"])
        )
    
    # ========== PROJECTS (PostgreSQL) ==========
    
    async def create_project(self, user_id: str, name: str, domain: str, feed_url: str = "") -> Dict[str, Any]:
        """Создание нового проекта"""
        project_id = generate_project_id()
        api_key = generate_api_key()
        
        project = await db.create_project(project_id, user_id, name, domain, feed_url, api_key)
        
        # Кэшируем API ключ в Redis для быстрого доступа при поиске
        await self.redis.set(f"apikey:{api_key}", project_id)
        
        return project
    
    async def get_project(self, project_id: str) -> Optional[Dict[str, Any]]:
        """Получение проекта по ID"""
        return await db.get_project(project_id)
    
    async def get_project_by_api_key(self, api_key: str) -> Optional[Dict[str, Any]]:
        """Получение проекта по API ключу"""
        # Сначала проверяем кэш в Redis
        project_id = await self.redis.get(f"apikey:{api_key}")
        if project_id:
            if isinstance(project_id, bytes):
                project_id = project_id.decode()
            project = await db.get_project(project_id)
            if project:
                return project
        
        # Если нет в кэше - ищем в PostgreSQL
        project = await db.get_project_by_api_key(api_key)
        if project:
            # Кэшируем для будущих запросов
            await self.redis.set(f"apikey:{api_key}", project["id"])
        
        return project
    
    async def get_user_projects(self, user_id: str) -> List[Dict[str, Any]]:
        """Получение всех проектов пользователя"""
        return await db.get_user_projects(user_id)
    
    async def update_project(self, project_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Обновление проекта"""
        return await db.update_project(project_id, updates)
    
    async def delete_project(self, project_id: str, user_id: str) -> bool:
        """Удаление проекта"""
        project = await db.get_project(project_id)
        if not project or project.get("user_id") != user_id:
            return False
        
        # Удаляем кэш API ключа из Redis
        api_key = project.get("api_key")
        if api_key:
            await self.redis.delete(f"apikey:{api_key}")
        
        # Удаляем связанные данные из Redis (товары, индексы)
        patterns = [
            f"products:{project_id}:*",
            f"idx:{project_id}:*",
            f"analytics:{project_id}:*"
        ]
        for pattern in patterns:
            cursor = 0
            while True:
                cursor, keys = await self.redis.scan(cursor, match=pattern, count=100)
                if keys:
                    await self.redis.delete(*keys)
                if cursor == 0:
                    break
        
        # Удаляем из PostgreSQL
        return await db.delete_project(project_id, user_id)
    
    async def regenerate_api_key(self, project_id: str) -> Optional[str]:
        """Перегенерация API ключа"""
        project = await db.get_project(project_id)
        if not project:
            return None
        
        # Удаляем старый кэш из Redis
        old_key = project.get("api_key")
        if old_key:
            await self.redis.delete(f"apikey:{old_key}")
        
        # Генерируем новый ключ
        new_key = generate_api_key()
        await db.regenerate_api_key(project_id, new_key)
        
        # Кэшируем новый ключ
        await self.redis.set(f"apikey:{new_key}", project_id)
        
        return new_key
    
    # ========== PRODUCTS (Redis) ==========
    
    async def save_products(self, project_id: str, products: List[Dict]) -> int:
        """Сохранение товаров проекта"""
        # Обновляем счетчик в PostgreSQL
        await db.update_products_count(project_id, len(products))
        
        # Сохраняем каждый товар в Redis
        pipe = self.redis.pipeline()
        
        for product in products:
            product_key = f"project:{project_id}:product:{product['id']}"
            pipe.set(product_key, json.dumps(product))
        
        # Сохраняем список ID товаров
        product_ids = [p["id"] for p in products]
        pipe.delete(f"project:{project_id}:product_ids")
        if product_ids:
            pipe.sadd(f"project:{project_id}:product_ids", *product_ids)
        
        # Обновляем счетчик
        pipe.hset(f"project:{project_id}", "products_count", len(products))
        
        await pipe.execute()
        return len(products)
    
    async def get_products(self, project_id: str, limit: int = 100, offset: int = 0) -> List[Dict]:
        """Получение товаров проекта"""
        # Получаем все ID товаров
        product_ids = await self.redis.smembers(f"project:{project_id}:product_ids")
        
        products = []
        ids_list = list(product_ids)[offset:offset + limit]
        
        for pid in ids_list:
            if isinstance(pid, bytes):
                pid = pid.decode()
            
            product_data = await self.redis.get(f"project:{project_id}:product:{pid}")
            if product_data:
                if isinstance(product_data, bytes):
                    product_data = product_data.decode()
                products.append(json.loads(product_data))
        
        return products
    
    async def get_products_count(self, project_id: str) -> int:
        """Количество товаров в проекте"""
        return await self.redis.scard(f"project:{project_id}:product_ids")
    
    # ========== ANALYTICS ==========
    
    async def log_search(self, project_id: str, query: str, results_count: int, took_ms: float):
        """Логирование поискового запроса"""
        now = datetime.utcnow()
        day_key = now.strftime("%Y-%m-%d")
        hour_key = now.strftime("%Y-%m-%d-%H")
        
        pipe = self.redis.pipeline()
        
        # Счетчик запросов за день
        pipe.incr(f"analytics:{project_id}:queries:{day_key}")
        pipe.expire(f"analytics:{project_id}:queries:{day_key}", 86400 * 30)  # 30 дней
        
        # Счетчик по часам
        pipe.incr(f"analytics:{project_id}:queries:hourly:{hour_key}")
        pipe.expire(f"analytics:{project_id}:queries:hourly:{hour_key}", 86400 * 7)  # 7 дней
        
        # Популярные запросы
        pipe.zincrby(f"analytics:{project_id}:popular_queries", 1, query.lower())
        
        # Среднее время ответа
        pipe.lpush(f"analytics:{project_id}:response_times", took_ms)
        pipe.ltrim(f"analytics:{project_id}:response_times", 0, 999)  # Последние 1000
        
        await pipe.execute()
    
    async def get_analytics(self, project_id: str, days: int = 7) -> Dict[str, Any]:
        """Получение аналитики проекта"""
        now = datetime.utcnow()
        
        # Запросы по дням
        queries_by_day = {}
        total_queries = 0
        
        for i in range(days):
            day = (now - timedelta(days=i)).strftime("%Y-%m-%d")
            count = await self.redis.get(f"analytics:{project_id}:queries:{day}")
            count = int(count) if count else 0
            queries_by_day[day] = count
            total_queries += count
        
        # Популярные запросы (топ-20)
        popular = await self.redis.zrevrange(
            f"analytics:{project_id}:popular_queries", 
            0, 19, 
            withscores=True
        )
        
        popular_queries = []
        for item in popular:
            query = item[0].decode() if isinstance(item[0], bytes) else item[0]
            count = int(item[1])
            popular_queries.append({"query": query, "count": count})
        
        # Среднее время ответа
        times = await self.redis.lrange(f"analytics:{project_id}:response_times", 0, -1)
        avg_response_time = 0
        if times:
            times_float = [float(t) for t in times]
            avg_response_time = sum(times_float) / len(times_float)
        
        return {
            "total_queries": total_queries,
            "queries_by_day": queries_by_day,
            "popular_queries": popular_queries,
            "avg_response_time_ms": round(avg_response_time, 2)
        }
    
    async def log_click(self, project_id: str, product_id: str, query: str):
        """Логирование клика по товару"""
        now = datetime.utcnow()
        day_key = now.strftime("%Y-%m-%d")
        
        pipe = self.redis.pipeline()
        
        # Счетчик кликов за день
        pipe.incr(f"analytics:{project_id}:clicks:{day_key}")
        pipe.expire(f"analytics:{project_id}:clicks:{day_key}", 86400 * 30)
        
        # Популярные товары
        pipe.zincrby(f"analytics:{project_id}:popular_products", 1, product_id)
        
        # Запросы приводящие к кликам
        pipe.zincrby(f"analytics:{project_id}:converting_queries", 1, query.lower())
        
        await pipe.execute()
