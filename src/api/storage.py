"""
Хранилище данных - пользователи, проекты, аналитика
Использует Redis для хранения
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


class DataStore:
    """Хранилище данных в Redis"""
    
    def __init__(self, redis_client):
        self.redis = redis_client
    
    # ========== USERS ==========
    
    async def create_user(self, data: UserCreate) -> Optional[Token]:
        """Создание нового пользователя"""
        # Проверяем, не занят ли email
        existing = await self.redis.get(f"user:email:{data.email}")
        if existing:
            return None
        
        user_id = generate_user_id()
        now = datetime.utcnow().isoformat()
        
        user_data = {
            "id": user_id,
            "email": data.email,
            "name": data.name,
            "password_hash": hash_password(data.password),
            "created_at": now
        }
        
        # Сохраняем пользователя
        await self.redis.set(f"user:{user_id}", json.dumps(user_data))
        await self.redis.set(f"user:email:{data.email}", user_id)
        
        # Создаем токен
        access_token = create_access_token(user_id, data.email)
        
        return Token(
            access_token=access_token,
            user=User(
                id=user_id,
                email=data.email,
                name=data.name,
                created_at=now
            )
        )
    
    async def login_user(self, data: UserLogin) -> Optional[Token]:
        """Авторизация пользователя"""
        # Находим пользователя по email
        user_id = await self.redis.get(f"user:email:{data.email}")
        if not user_id:
            return None
        
        if isinstance(user_id, bytes):
            user_id = user_id.decode()
        
        # Получаем данные пользователя
        user_data = await self.redis.get(f"user:{user_id}")
        if not user_data:
            return None
        
        if isinstance(user_data, bytes):
            user_data = user_data.decode()
        
        user = json.loads(user_data)
        
        # Проверяем пароль
        if not verify_password(data.password, user["password_hash"]):
            return None
        
        # Создаем токен
        access_token = create_access_token(user_id, data.email)
        
        return Token(
            access_token=access_token,
            user=User(
                id=user["id"],
                email=user["email"],
                name=user["name"],
                created_at=user["created_at"]
            )
        )
    
    async def get_user(self, user_id: str) -> Optional[User]:
        """Получение пользователя по ID"""
        user_data = await self.redis.get(f"user:{user_id}")
        if not user_data:
            return None
        
        if isinstance(user_data, bytes):
            user_data = user_data.decode()
        
        user = json.loads(user_data)
        return User(
            id=user["id"],
            email=user["email"],
            name=user["name"],
            created_at=user["created_at"]
        )
    
    # ========== PROJECTS ==========
    
    async def create_project(self, user_id: str, name: str, domain: str, feed_url: str = "") -> Dict[str, Any]:
        """Создание нового проекта"""
        project_id = generate_project_id()
        api_key = generate_api_key()
        now = datetime.utcnow().isoformat()
        
        project = {
            "id": project_id,
            "user_id": user_id,
            "name": name,
            "domain": domain,
            "feed_url": feed_url,
            "api_key": api_key,
            "created_at": now,
            "status": "active",
            "products_count": 0,
            "widget_settings": json.dumps({
                "theme": "light",
                "primaryColor": "#2563eb",
                "borderRadius": 8,
                "showImages": True,
                "showPrices": True,
                "placeholder": "Поиск товаров...",
                "maxResults": 10
            })
        }
        
        # Сохраняем проект
        await self.redis.hset(f"project:{project_id}", mapping=project)
        
        # Добавляем в список проектов пользователя
        await self.redis.sadd(f"user:{user_id}:projects", project_id)
        
        # Индекс по API ключу
        await self.redis.set(f"apikey:{api_key}", project_id)
        
        return project
    
    async def get_project(self, project_id: str) -> Optional[Dict[str, Any]]:
        """Получение проекта по ID"""
        project = await self.redis.hgetall(f"project:{project_id}")
        if not project:
            return None
        
        # Декодируем bytes
        result = {}
        for k, v in project.items():
            key = k.decode() if isinstance(k, bytes) else k
            val = v.decode() if isinstance(v, bytes) else v
            result[key] = val
        
        return result
    
    async def get_project_by_api_key(self, api_key: str) -> Optional[Dict[str, Any]]:
        """Получение проекта по API ключу"""
        project_id = await self.redis.get(f"apikey:{api_key}")
        if not project_id:
            return None
        
        if isinstance(project_id, bytes):
            project_id = project_id.decode()
        
        return await self.get_project(project_id)
    
    async def get_user_projects(self, user_id: str) -> List[Dict[str, Any]]:
        """Получение всех проектов пользователя"""
        project_ids = await self.redis.smembers(f"user:{user_id}:projects")
        
        projects = []
        for pid in project_ids:
            if isinstance(pid, bytes):
                pid = pid.decode()
            project = await self.get_project(pid)
            if project:
                projects.append(project)
        
        return projects
    
    async def update_project(self, project_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Обновление проекта"""
        project = await self.get_project(project_id)
        if not project:
            return None
        
        # Обновляем поля
        for key, value in updates.items():
            if key not in ["id", "user_id", "api_key", "created_at"]:  # Защищенные поля
                await self.redis.hset(f"project:{project_id}", key, 
                    json.dumps(value) if isinstance(value, (dict, list)) else str(value))
        
        return await self.get_project(project_id)
    
    async def delete_project(self, project_id: str, user_id: str) -> bool:
        """Удаление проекта"""
        project = await self.get_project(project_id)
        if not project or project.get("user_id") != user_id:
            return False
        
        # Удаляем индекс API ключа
        api_key = project.get("api_key")
        if api_key:
            await self.redis.delete(f"apikey:{api_key}")
        
        # Удаляем из списка пользователя
        await self.redis.srem(f"user:{user_id}:projects", project_id)
        
        # Удаляем сам проект и связанные данные
        await self.redis.delete(f"project:{project_id}")
        await self.redis.delete(f"project:{project_id}:feed")
        await self.redis.delete(f"project:{project_id}:products")
        
        return True
    
    async def regenerate_api_key(self, project_id: str) -> Optional[str]:
        """Перегенерация API ключа"""
        project = await self.get_project(project_id)
        if not project:
            return None
        
        # Удаляем старый индекс
        old_key = project.get("api_key")
        if old_key:
            await self.redis.delete(f"apikey:{old_key}")
        
        # Создаем новый ключ
        new_key = generate_api_key()
        await self.redis.hset(f"project:{project_id}", "api_key", new_key)
        await self.redis.set(f"apikey:{new_key}", project_id)
        
        return new_key
    
    # ========== PRODUCTS ==========
    
    async def save_products(self, project_id: str, products: List[Dict]) -> int:
        """Сохранение товаров проекта"""
        # Сохраняем каждый товар
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
