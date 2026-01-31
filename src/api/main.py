"""
FastAPI приложение - базовая версия без ML
"""
from fastapi import FastAPI, HTTPException, Query, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from typing import Optional, List
import redis.asyncio as redis
from contextlib import asynccontextmanager

from ..search.query_processor_simple import SimpleQueryProcessor, NGramGenerator
from ..search.indexer_simple import SimpleIndexer
from ..search.engine_simple import SimpleSearchEngine


# Глобальные объекты
redis_client = None
search_engine = None
indexer = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Инициализация и очистка ресурсов"""
    global redis_client, search_engine, indexer
    
    # Подключение к Redis
    redis_client = await redis.from_url(
        "redis://redis:6379",
        encoding="utf-8",
        decode_responses=False
    )
    
    # Инициализация компонентов
    query_processor = SimpleQueryProcessor()
    ngram_gen = NGramGenerator(n=3)
    
    search_engine = SimpleSearchEngine(redis_client, query_processor, ngram_gen)
    indexer = SimpleIndexer(redis_client, query_processor, ngram_gen)
    
    print("✓ Search service initialized")
    
    yield
    
    # Закрытие соединений
    await redis_client.close()
    print("✓ Connections closed")


# Создание приложения
app = FastAPI(
    title="Search Service API",
    description="External search service for e-commerce (Basic version without ML)",
    version="0.1.0",
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


def get_search_engine():
    """Dependency для получения search engine"""
    return search_engine


def get_indexer():
    """Dependency для получения indexer"""
    return indexer


@app.get("/")
async def root():
    """Главная страница"""
    return {
        "service": "Search Service",
        "version": "0.1.0 (Basic - no ML)",
        "status": "running"
    }


@app.get("/health")
async def health():
    """Health check"""
    try:
        await redis_client.ping()
        return {"status": "healthy", "redis": "connected"}
    except Exception as e:
        return JSONResponse(
            status_code=503,
            content={"status": "unhealthy", "error": str(e)}
        )


@app.get("/api/v1/search")
async def search(
    q: str = Query(..., description="Search query"),
    project_id: str = Query("demo", description="Project ID"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    in_stock: Optional[bool] = Query(None),
    price_min: Optional[float] = Query(None),
    price_max: Optional[float] = Query(None),
    category: Optional[str] = Query(None),
    sort: str = Query("relevance", regex="^(relevance|price_asc|price_desc)$"),
    engine: SimpleSearchEngine = Depends(get_search_engine)
):
    """
    Поиск товаров
    
    - **q**: Поисковый запрос
    - **project_id**: ID проекта (для демо используйте "demo")
    - **limit**: Количество результатов (1-100)
    - **offset**: Смещение для пагинации
    - **in_stock**: Только товары в наличии
    - **price_min**: Минимальная цена
    - **price_max**: Максимальная цена
    - **category**: Фильтр по категории
    - **sort**: Сортировка (relevance, price_asc, price_desc)
    """
    try:
        # Собираем фильтры
        filters = {}
        if in_stock is not None:
            filters["in_stock"] = in_stock
        if price_min is not None:
            filters["price_min"] = price_min
        if price_max is not None:
            filters["price_max"] = price_max
        if category:
            filters["category"] = category
        
        # Выполняем поиск
        result = await engine.search(
            project_id=project_id,
            query=q,
            limit=limit,
            offset=offset,
            filters=filters if filters else None,
            sort=sort
        )
        
        return {
            "success": True,
            "query": result.query,
            "total": result.total,
            "limit": limit,
            "offset": offset,
            "items": result.items,
            "meta": {
                "took_ms": result.took_ms,
                "version": "basic"
            }
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/suggest")
async def suggest(
    q: str = Query(..., description="Search prefix"),
    project_id: str = Query("demo", description="Project ID"),
    limit: int = Query(10, ge=1, le=20),
    include_products: bool = Query(True),
    engine: SimpleSearchEngine = Depends(get_search_engine)
):
    """
    Подсказки для автодополнения
    
    - **q**: Префикс для поиска
    - **project_id**: ID проекта
    - **limit**: Количество подсказок
    - **include_products**: Включить товары в ответ
    """
    try:
        result = await engine.suggest(
            project_id=project_id,
            prefix=q,
            limit=limit,
            include_products=include_products
        )
        
        return {
            "success": True,
            "prefix": result.prefix,
            "suggestions": result.suggestions,
            "products": result.products if include_products else []
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/index")
async def index_products(
    project_id: str = Query("demo", description="Project ID"),
    products: List[dict] = None,
    indexer_service: SimpleIndexer = Depends(get_indexer)
):
    """
    Индексация товаров
    
    Загружает список товаров в индекс для поиска.
    
    Формат товара:
    ```json
    {
        "id": "SKU-123",
        "name": "Product name",
        "description": "Description",
        "url": "https://...",
        "image": "https://...",
        "price": 1000,
        "old_price": 1500,
        "in_stock": true,
        "category": "Category",
        "brand": "Brand"
    }
    ```
    """
    try:
        if not products:
            raise HTTPException(status_code=400, detail="No products provided")
        
        # Конвертируем в модели
        from ..core.models import Product
        product_objects = [
            Product(
                id=p.get("id"),
                name=p.get("name"),
                url=p.get("url", ""),
                description=p.get("description"),
                image=p.get("image"),
                price=p.get("price"),
                old_price=p.get("old_price"),
                in_stock=p.get("in_stock", True),
                category=p.get("category"),
                brand=p.get("brand"),
            )
            for p in products
        ]
        
        # Индексируем
        count = await indexer_service.index_products(project_id, product_objects)
        
        return {
            "success": True,
            "indexed": count,
            "project_id": project_id
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
