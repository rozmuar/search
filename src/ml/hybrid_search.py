"""
Hybrid Search Engine - гибридный поиск с ML

Объединяет:
1. BM25 (keyword search) - быстрый поиск по ключевым словам
2. Vector Search (semantic) - семантический поиск по embeddings
3. Neural Re-ranker - переранжирование топ-N результатов
"""
import numpy as np
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass, field
import time

from .embeddings import EmbeddingService, EmbeddingModel
from .reranker import NeuralReranker
from .spell_checker import SpellChecker


@dataclass
class HybridSearchConfig:
    """Конфигурация гибридного поиска"""
    # Веса для объединения результатов
    bm25_weight: float = 0.5
    vector_weight: float = 0.5
    
    # Количество результатов
    bm25_top_k: int = 100
    vector_top_k: int = 100
    rerank_top_k: int = 20
    final_top_k: int = 20
    
    # Включение компонентов
    use_vector_search: bool = True
    use_reranker: bool = True
    use_spell_check: bool = True
    
    # RRF (Reciprocal Rank Fusion) параметр
    rrf_k: int = 60


@dataclass
class HybridSearchResult:
    """Результат гибридного поиска"""
    query: str
    corrected_query: Optional[str]
    items: List[Dict[str, Any]]
    total: int
    
    # Детали поиска
    bm25_time_ms: int = 0
    vector_time_ms: int = 0
    rerank_time_ms: int = 0
    total_time_ms: int = 0
    
    # Флаги
    spell_corrected: bool = False
    used_vector: bool = False
    used_reranker: bool = False


class HybridSearchEngine:
    """
    Гибридный поисковый движок
    
    Алгоритм:
    1. Spell correction (исправление опечаток)
    2. BM25 search (keyword) -> top-100
    3. Vector search (semantic) -> top-100
    4. Merge with RRF (Reciprocal Rank Fusion) -> top-100
    5. Neural re-ranker -> top-20
    """
    
    def __init__(
        self,
        bm25_searcher,  # Существующий BM25 поиск (SearchEngine)
        embedding_service: Optional[EmbeddingService] = None,
        reranker: Optional[NeuralReranker] = None,
        spell_checker: Optional[SpellChecker] = None,
        vector_store=None,  # Qdrant/Redis Vector client
        config: Optional[HybridSearchConfig] = None
    ):
        self.bm25_searcher = bm25_searcher
        self.embedding_service = embedding_service
        self.reranker = reranker
        self.spell_checker = spell_checker
        self.vector_store = vector_store
        self.config = config or HybridSearchConfig()
    
    async def search(
        self,
        project_id: str,
        query: str,
        limit: int = 20,
        offset: int = 0,
        filters: Optional[Dict[str, Any]] = None,
        **kwargs
    ) -> HybridSearchResult:
        """
        Выполнение гибридного поиска
        """
        start_time = time.time()
        
        # 1. Spell correction
        corrected_query = query
        spell_corrected = False
        
        if self.config.use_spell_check and self.spell_checker:
            spell_result = self.spell_checker.check(query)
            if spell_result.was_corrected:
                corrected_query = spell_result.corrected
                spell_corrected = True
        
        # 2. BM25 Search
        bm25_start = time.time()
        bm25_results = await self._bm25_search(
            project_id, 
            corrected_query, 
            self.config.bm25_top_k,
            filters
        )
        bm25_time = int((time.time() - bm25_start) * 1000)
        
        # 3. Vector Search (если включено)
        vector_results = []
        vector_time = 0
        used_vector = False
        
        if self.config.use_vector_search and self.embedding_service and self.vector_store:
            vector_start = time.time()
            vector_results = await self._vector_search(
                project_id,
                corrected_query,
                self.config.vector_top_k,
                filters
            )
            vector_time = int((time.time() - vector_start) * 1000)
            used_vector = True
        
        # 4. Merge results with RRF
        if vector_results:
            merged = self._merge_results_rrf(bm25_results, vector_results)
        else:
            merged = bm25_results
        
        # 5. Neural Re-ranker (если включено)
        rerank_time = 0
        used_reranker = False
        
        if self.config.use_reranker and self.reranker and len(merged) > 0:
            rerank_start = time.time()
            merged = self._rerank_results(corrected_query, merged)
            rerank_time = int((time.time() - rerank_start) * 1000)
            used_reranker = True
        
        # 6. Pagination
        total = len(merged)
        items = merged[offset:offset + limit]
        
        total_time = int((time.time() - start_time) * 1000)
        
        return HybridSearchResult(
            query=query,
            corrected_query=corrected_query if spell_corrected else None,
            items=items,
            total=total,
            bm25_time_ms=bm25_time,
            vector_time_ms=vector_time,
            rerank_time_ms=rerank_time,
            total_time_ms=total_time,
            spell_corrected=spell_corrected,
            used_vector=used_vector,
            used_reranker=used_reranker
        )
    
    async def _bm25_search(
        self,
        project_id: str,
        query: str,
        limit: int,
        filters: Optional[Dict]
    ) -> List[Dict[str, Any]]:
        """BM25 поиск через существующий движок"""
        result = await self.bm25_searcher.search(
            project_id=project_id,
            query=query,
            limit=limit,
            filters=filters
        )
        
        # Преобразуем в список dict с рангом
        items = []
        for i, product in enumerate(result.items):
            item = product.__dict__ if hasattr(product, '__dict__') else product
            item = dict(item)
            item['_bm25_rank'] = i + 1
            item['_bm25_score'] = 1.0 / (i + 1)  # Simple score
            items.append(item)
        
        return items
    
    async def _vector_search(
        self,
        project_id: str,
        query: str,
        limit: int,
        filters: Optional[Dict]
    ) -> List[Dict[str, Any]]:
        """Векторный поиск"""
        # Получаем embedding запроса
        query_embedding = await self.embedding_service.encode_query(query)
        
        # Поиск в vector store
        # Это пример для Qdrant, адаптируйте под ваш vector store
        results = await self._search_vector_store(
            project_id,
            query_embedding,
            limit,
            filters
        )
        
        # Добавляем ранги
        for i, item in enumerate(results):
            item['_vector_rank'] = i + 1
            item['_vector_score'] = item.get('_score', 1.0 / (i + 1))
        
        return results
    
    async def _search_vector_store(
        self,
        project_id: str,
        query_embedding: np.ndarray,
        limit: int,
        filters: Optional[Dict]
    ) -> List[Dict[str, Any]]:
        """
        Поиск в векторном хранилище
        
        Пример для Qdrant (адаптируйте под ваш vector store)
        """
        if hasattr(self.vector_store, 'search'):
            # Qdrant-like interface
            results = await self.vector_store.search(
                collection_name=f"products_{project_id}",
                query_vector=query_embedding.tolist(),
                limit=limit,
                query_filter=self._build_vector_filter(filters) if filters else None
            )
            
            return [
                {
                    **hit.payload,
                    '_score': hit.score
                }
                for hit in results
            ]
        
        # Fallback: простой brute-force поиск в Redis
        return await self._brute_force_vector_search(
            project_id, query_embedding, limit
        )
    
    async def _brute_force_vector_search(
        self,
        project_id: str,
        query_embedding: np.ndarray,
        limit: int
    ) -> List[Dict[str, Any]]:
        """
        Простой векторный поиск (для небольших коллекций)
        """
        # Получаем все embeddings из Redis
        # В реальности используйте Redis Vector Search или Qdrant
        return []
    
    def _build_vector_filter(self, filters: Dict) -> Dict:
        """Построение фильтра для vector store"""
        # Пример для Qdrant
        conditions = []
        
        if filters.get('in_stock'):
            conditions.append({
                'key': 'in_stock',
                'match': {'value': True}
            })
        
        if filters.get('category'):
            conditions.append({
                'key': 'category',
                'match': {'value': filters['category']}
            })
        
        if filters.get('price_min') or filters.get('price_max'):
            price_range = {}
            if filters.get('price_min'):
                price_range['gte'] = filters['price_min']
            if filters.get('price_max'):
                price_range['lte'] = filters['price_max']
            conditions.append({
                'key': 'price',
                'range': price_range
            })
        
        if conditions:
            return {'must': conditions}
        return None
    
    def _merge_results_rrf(
        self,
        bm25_results: List[Dict],
        vector_results: List[Dict]
    ) -> List[Dict]:
        """
        Объединение результатов с помощью Reciprocal Rank Fusion
        
        RRF Score = Σ 1 / (k + rank)
        
        где k - параметр (обычно 60)
        """
        k = self.config.rrf_k
        
        # Словарь для хранения RRF scores
        rrf_scores: Dict[str, float] = {}
        products: Dict[str, Dict] = {}
        
        # Обрабатываем BM25 результаты
        for item in bm25_results:
            product_id = item['id']
            rank = item['_bm25_rank']
            rrf_scores[product_id] = rrf_scores.get(product_id, 0) + (1.0 / (k + rank))
            products[product_id] = item
        
        # Обрабатываем Vector результаты
        for item in vector_results:
            product_id = item['id']
            rank = item['_vector_rank']
            rrf_scores[product_id] = rrf_scores.get(product_id, 0) + (1.0 / (k + rank))
            if product_id not in products:
                products[product_id] = item
            else:
                # Обновляем vector score
                products[product_id]['_vector_score'] = item.get('_vector_score', 0)
        
        # Сортируем по RRF score
        sorted_ids = sorted(rrf_scores.keys(), key=lambda x: rrf_scores[x], reverse=True)
        
        # Формируем результат
        result = []
        for product_id in sorted_ids:
            item = products[product_id]
            item['_rrf_score'] = rrf_scores[product_id]
            result.append(item)
        
        return result
    
    def _rerank_results(
        self,
        query: str,
        items: List[Dict]
    ) -> List[Dict]:
        """
        Переранжирование с помощью neural re-ranker
        """
        # Ограничиваем количество для re-ranker
        items_to_rerank = items[:self.config.rerank_top_k]
        
        # Применяем re-ranker
        reranked = self.reranker.rerank_products(
            query=query,
            products=items_to_rerank,
            text_field="name",
            top_k=self.config.final_top_k
        )
        
        return reranked


class VectorIndexer:
    """
    Индексатор для векторного поиска
    
    Добавляет embeddings при индексации товаров
    """
    
    def __init__(
        self,
        embedding_service: EmbeddingService,
        vector_store,
        batch_size: int = 128
    ):
        self.embedding_service = embedding_service
        self.vector_store = vector_store
        self.batch_size = batch_size
    
    async def index_products(
        self,
        project_id: str,
        products: List[Dict[str, Any]]
    ) -> int:
        """
        Индексация товаров с embeddings
        """
        collection_name = f"products_{project_id}"
        
        # Создаём коллекцию, если не существует
        await self._ensure_collection(collection_name)
        
        indexed = 0
        
        # Обрабатываем батчами
        for i in range(0, len(products), self.batch_size):
            batch = products[i:i + self.batch_size]
            
            # Генерируем embeddings
            embeddings = await self.embedding_service.encode_products(batch)
            
            # Готовим точки для вставки
            points = []
            for product in batch:
                product_id = product['id']
                if product_id in embeddings:
                    points.append({
                        'id': product_id,
                        'vector': embeddings[product_id].tolist(),
                        'payload': {
                            'id': product_id,
                            'name': product.get('name', ''),
                            'price': product.get('price', 0),
                            'in_stock': product.get('in_stock', True),
                            'category': product.get('category', ''),
                            'brand': product.get('brand', ''),
                            'url': product.get('url', ''),
                            'image': product.get('image', ''),
                        }
                    })
            
            # Вставляем в vector store
            if points:
                await self._upsert_points(collection_name, points)
                indexed += len(points)
        
        return indexed
    
    async def _ensure_collection(self, collection_name: str):
        """Создание коллекции, если не существует"""
        if hasattr(self.vector_store, 'create_collection'):
            try:
                await self.vector_store.create_collection(
                    collection_name=collection_name,
                    vectors_config={
                        'size': self.embedding_service.model.dimension,
                        'distance': 'Cosine'
                    }
                )
            except Exception:
                pass  # Коллекция уже существует
    
    async def _upsert_points(self, collection_name: str, points: List[Dict]):
        """Вставка/обновление точек"""
        if hasattr(self.vector_store, 'upsert'):
            await self.vector_store.upsert(
                collection_name=collection_name,
                points=points
            )
    
    async def delete_collection(self, project_id: str):
        """Удаление коллекции"""
        collection_name = f"products_{project_id}"
        if hasattr(self.vector_store, 'delete_collection'):
            await self.vector_store.delete_collection(collection_name)
