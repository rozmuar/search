"""
FastAPI приложение - полная версия с авторизацией, проектами, фидами
"""
from fastapi import FastAPI, HTTPException, Query, Depends, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse, Response
from fastapi.staticfiles import StaticFiles
from typing import Optional, List
import redis.asyncio as redis
from contextlib import asynccontextmanager
from pydantic import BaseModel, EmailStr
import json
import os
from datetime import datetime

from ..search.query_processor_simple import SimpleQueryProcessor, NGramGenerator
from ..search.indexer_simple import SimpleIndexer
from ..search.engine_simple import SimpleSearchEngine
from .auth import decode_token, UserCreate, UserLogin, User
from .storage import DataStore
from ..feed.parser import FeedParser, FeedManager
from ..feed.scheduler import start_feed_scheduler, stop_feed_scheduler
from ..core.models import Product


# Глобальные объекты
redis_client = None
search_engine = None
indexer = None
data_store = None
feed_manager = None
feed_scheduler = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Инициализация и очистка ресурсов"""
    global redis_client, search_engine, indexer, data_store, feed_manager, feed_scheduler
    
    # Подключение к Redis
    redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379")
    redis_client = await redis.from_url(
        redis_url,
        encoding="utf-8",
        decode_responses=False
    )
    
    # Инициализация компонентов
    query_processor = SimpleQueryProcessor()
    ngram_gen = NGramGenerator(n=3)
    
    search_engine = SimpleSearchEngine(redis_client, query_processor, ngram_gen)
    indexer = SimpleIndexer(redis_client, query_processor, ngram_gen)
    data_store = DataStore(redis_client)
    feed_manager = FeedManager(redis_client)
    
    # Запуск планировщика автообновления фидов
    feed_scheduler = await start_feed_scheduler(redis_client, feed_manager, data_store, indexer)
    
    print("✓ Search service initialized (full version)")
    
    yield
    
    # Остановка планировщика
    await stop_feed_scheduler()
    
    # Закрытие соединений
    await redis_client.close()
    print("✓ Connections closed")


# Создание приложения
app = FastAPI(
    title="Search Service API",
    description="API для поискового сервиса e-commerce",
    version="1.0.0",
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============ HELPERS ============

async def get_current_user(authorization: Optional[str] = Header(None)) -> Optional[User]:
    """Получение текущего пользователя из токена"""
    if not authorization:
        return None
    
    try:
        # Bearer token
        token = authorization.replace("Bearer ", "")
        payload = decode_token(token)
        if not payload:
            return None
        
        user = await data_store.get_user(payload["sub"])
        return user
    except:
        return None


async def require_auth(authorization: Optional[str] = Header(None)) -> User:
    """Требование авторизации"""
    user = await get_current_user(authorization)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return user


# ============ AUTH ENDPOINTS ============

@app.post("/api/v1/auth/register")
async def register(data: UserCreate):
    """Регистрация нового пользователя"""
    result = await data_store.create_user(data)
    if not result:
        raise HTTPException(status_code=400, detail="Email already exists")
    return result


@app.post("/api/v1/auth/login")
async def login(data: UserLogin):
    """Авторизация пользователя"""
    result = await data_store.login_user(data)
    if not result:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return result


@app.get("/api/v1/auth/me")
async def get_me(user: User = Depends(require_auth)):
    """Получение текущего пользователя"""
    return user


# ============ PROJECTS ENDPOINTS ============

class ProjectCreate(BaseModel):
    name: str
    domain: str
    feed_url: Optional[str] = ""


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    domain: Optional[str] = None
    feed_url: Optional[str] = None
    widget_settings: Optional[dict] = None


@app.get("/api/v1/projects")
async def list_projects(user: User = Depends(require_auth)):
    """Список проектов пользователя"""
    projects = await data_store.get_user_projects(user.id)
    return {"projects": projects}


@app.post("/api/v1/projects")
async def create_project(data: ProjectCreate, user: User = Depends(require_auth)):
    """Создание нового проекта"""
    project = await data_store.create_project(
        user_id=user.id,
        name=data.name,
        domain=data.domain,
        feed_url=data.feed_url
    )
    return project


@app.get("/api/v1/projects/{project_id}")
async def get_project(project_id: str, user: User = Depends(require_auth)):
    """Получение проекта"""
    project = await data_store.get_project(project_id)
    if not project or project.get("user_id") != user.id:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@app.put("/api/v1/projects/{project_id}")
async def update_project(project_id: str, data: ProjectUpdate, user: User = Depends(require_auth)):
    """Обновление проекта"""
    project = await data_store.get_project(project_id)
    if not project or project.get("user_id") != user.id:
        raise HTTPException(status_code=404, detail="Project not found")
    
    updates = {k: v for k, v in data.dict().items() if v is not None}
    updated = await data_store.update_project(project_id, updates)
    return updated


@app.delete("/api/v1/projects/{project_id}")
async def delete_project(project_id: str, user: User = Depends(require_auth)):
    """Удаление проекта"""
    success = await data_store.delete_project(project_id, user.id)
    if not success:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"success": True}


@app.post("/api/v1/projects/{project_id}/regenerate-key")
async def regenerate_api_key(project_id: str, user: User = Depends(require_auth)):
    """Перегенерация API ключа"""
    project = await data_store.get_project(project_id)
    if not project or project.get("user_id") != user.id:
        raise HTTPException(status_code=404, detail="Project not found")
    
    new_key = await data_store.regenerate_api_key(project_id)
    return {"api_key": new_key}


# ============ FEED ENDPOINTS ============

class FeedLoadRequest(BaseModel):
    url: str

@app.post("/api/v1/projects/{project_id}/feed/load")
async def load_feed(project_id: str, request: FeedLoadRequest, user: User = Depends(require_auth)):
    """Загрузка фида проекта"""
    project = await data_store.get_project(project_id)
    if not project or project.get("user_id") != user.id:
        raise HTTPException(status_code=404, detail="Project not found")
    
    feed_url = request.url
    if not feed_url:
        raise HTTPException(status_code=400, detail="Feed URL not provided")
    
    # Сохраняем URL фида в проект
    await data_store.update_project(project_id, {"feed_url": feed_url})
    
    # Загружаем фид
    result = await feed_manager.load_feed(project_id, feed_url)
    
    if result["success"]:
        # Сохраняем товары
        await data_store.save_products(project_id, result["products"])
        
        # Конвертируем dict в Product для индексатора
        products_list = []
        for p in result["products"]:
            try:
                product = Product(
                    id=str(p.get("id", "")),
                    name=p.get("name", ""),
                    url=p.get("url", ""),
                    description=p.get("description"),
                    image=p.get("image"),
                    images=p.get("images", []),
                    price=float(p.get("price", 0) or 0),
                    old_price=float(p.get("old_price") or 0) if p.get("old_price") else None,
                    in_stock=p.get("in_stock", True),
                    category=p.get("category"),
                    brand=p.get("brand"),
                )
                products_list.append(product)
            except Exception as e:
                print(f"Error converting product {p.get('id')}: {e}")
                continue
        
        # Индексируем товары для поиска
        await indexer.index_products(project_id, products_list)
        
        return {
            "success": True,
            "products_count": result["products_count"],
            "categories_count": result["categories_count"],
            "message": f"Loaded {result['products_count']} products"
        }
    else:
        raise HTTPException(status_code=400, detail=result.get("error", "Failed to load feed"))


@app.get("/api/v1/projects/{project_id}/feed/status")
async def get_feed_status(project_id: str, user: User = Depends(require_auth)):
    """Статус фида проекта"""
    project = await data_store.get_project(project_id)
    if not project or project.get("user_id") != user.id:
        raise HTTPException(status_code=404, detail="Project not found")
    
    status = await feed_manager.get_feed_status(project_id)
    return status or {"status": "not_loaded"}


@app.get("/api/v1/projects/{project_id}/products")
async def get_products(
    project_id: str,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: User = Depends(require_auth)
):
    """Получение товаров проекта"""
    project = await data_store.get_project(project_id)
    if not project or project.get("user_id") != user.id:
        raise HTTPException(status_code=404, detail="Project not found")
    
    products = await data_store.get_products(project_id, limit, offset)
    total = await data_store.get_products_count(project_id)
    
    return {
        "products": products,
        "total": total,
        "limit": limit,
        "offset": offset
    }


# ============ ANALYTICS ENDPOINTS ============

@app.get("/api/v1/projects/{project_id}/analytics")
async def get_analytics(
    project_id: str,
    days: int = Query(7, ge=1, le=30),
    user: User = Depends(require_auth)
):
    """Аналитика проекта"""
    project = await data_store.get_project(project_id)
    if not project or project.get("user_id") != user.id:
        raise HTTPException(status_code=404, detail="Project not found")
    
    analytics = await data_store.get_analytics(project_id, days)
    return analytics


# ============ SEARCH ENDPOINT ============

@app.get("/api/v1/search")
async def search(
    q: str = Query(..., min_length=1, description="Поисковый запрос"),
    project_id: Optional[str] = Query(None, description="ID проекта"),
    api_key: Optional[str] = Query(None, description="API ключ"),
    limit: int = Query(10, ge=1, le=100),
    min_price: Optional[float] = None,
    max_price: Optional[float] = None,
    in_stock: Optional[bool] = None,
    category: Optional[str] = None
):
    """
    Поиск товаров
    
    Можно использовать project_id или api_key для идентификации проекта
    """
    import time
    start_time = time.time()
    
    # Определяем проект
    actual_project_id = project_id
    if api_key:
        project = await data_store.get_project_by_api_key(api_key)
        if project:
            actual_project_id = project["id"]
    
    if not actual_project_id:
        actual_project_id = "demo"  # Демо проект по умолчанию
    
    # Формируем фильтры
    filters = {}
    if min_price is not None:
        filters["min_price"] = min_price
    if max_price is not None:
        filters["max_price"] = max_price
    if in_stock is not None:
        filters["in_stock"] = in_stock
    if category:
        filters["category"] = category
    
    # Выполняем поиск
    results = await search_engine.search(
        query=q,
        project_id=actual_project_id,
        limit=limit,
        filters=filters
    )
    
    took_ms = (time.time() - start_time) * 1000
    
    # Логируем для аналитики
    await data_store.log_search(actual_project_id, q, len(results), took_ms)
    
    return {
        "items": results,
        "total": len(results),
        "query": q,
        "meta": {
            "took_ms": round(took_ms, 2),
            "project_id": actual_project_id
        }
    }


@app.get("/api/v1/suggest")
async def suggest(
    q: str = Query(..., min_length=1),
    project_id: Optional[str] = Query(None),
    api_key: Optional[str] = Query(None),
    limit: int = Query(5, ge=1, le=20)
):
    """Автодополнение запроса"""
    actual_project_id = project_id
    if api_key:
        project = await data_store.get_project_by_api_key(api_key)
        if project:
            actual_project_id = project["id"]
    
    if not actual_project_id:
        actual_project_id = "demo"
    
    suggestions = await search_engine.suggest(q, actual_project_id, limit)
    return {"suggestions": suggestions}


# ============ WIDGET SETTINGS ============

@app.get("/api/v1/projects/{project_id}/widget")
async def get_widget_settings(project_id: str, user: User = Depends(require_auth)):
    """Получение настроек виджета"""
    project = await data_store.get_project(project_id)
    if not project or project.get("user_id") != user.id:
        raise HTTPException(status_code=404, detail="Project not found")
    
    settings = project.get("widget_settings", "{}")
    try:
        return json.loads(settings)
    except:
        return {}


@app.put("/api/v1/projects/{project_id}/widget")
async def update_widget_settings(project_id: str, settings: dict, user: User = Depends(require_auth)):
    """Обновление настроек виджета"""
    project = await data_store.get_project(project_id)
    if not project or project.get("user_id") != user.id:
        raise HTTPException(status_code=404, detail="Project not found")
    
    await data_store.update_project(project_id, {"widget_settings": settings})
    return settings


# ============ PUBLIC WIDGET ENDPOINT ============

@app.get("/api/v1/widget/{api_key}/config")
async def get_widget_config(api_key: str):
    """Публичный endpoint для получения конфига виджета"""
    project = await data_store.get_project_by_api_key(api_key)
    if not project:
        raise HTTPException(status_code=404, detail="Invalid API key")
    
    settings = project.get("widget_settings", "{}")
    try:
        widget_settings = json.loads(settings) if isinstance(settings, str) else settings
    except:
        widget_settings = {}
    
    return widget_settings


# ============ EMBED.JS ENDPOINT ============

@app.get("/api/v1/widget/embed.js")
async def get_embed_script():
    """Отдача скрипта виджета"""
    # Путь к файлу embed.js
    embed_path = os.path.join(os.path.dirname(__file__), '..', 'web', 'embed.js')
    if not os.path.exists(embed_path):
        # Альтернативный путь
        embed_path = '/app/src/web/embed.js'
    
    if os.path.exists(embed_path):
        return FileResponse(
            embed_path,
            media_type='application/javascript',
            headers={
                'Cache-Control': 'public, max-age=3600',
                'Access-Control-Allow-Origin': '*'
            }
        )
    
    raise HTTPException(status_code=404, detail="Widget script not found")


# ============ TRACKING ENDPOINT ============

class ClickTrack(BaseModel):
    api_key: str
    product_id: str
    query: str


@app.post("/api/v1/track/click")
async def track_click(data: ClickTrack):
    """Трекинг клика по товару"""
    project = await data_store.get_project_by_api_key(data.api_key)
    if not project:
        return {"success": False}
    
    await data_store.log_click(project["id"], data.product_id, data.query)
    return {"success": True}


# ============ HEALTH CHECK ============

@app.get("/health")
async def health():
    """Health check"""
    try:
        await redis_client.ping()
        return {"status": "healthy", "redis": "connected"}
    except:
        return JSONResponse(
            status_code=503,
            content={"status": "unhealthy", "redis": "disconnected"}
        )


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "service": "Search Service API",
        "version": "1.0.0",
        "docs": "/docs"
    }
