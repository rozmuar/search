"""
Vector Store клиенты для разных баз данных
"""
import numpy as np
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
from abc import ABC, abstractmethod


@dataclass
class VectorSearchResult:
    """Результат векторного поиска"""
    id: str
    score: float
    payload: Dict[str, Any]


class VectorStore(ABC):
    """Абстрактный интерфейс для vector store"""
    
    @abstractmethod
    async def create_collection(
        self,
        collection_name: str,
        dimension: int,
        distance: str = "cosine"
    ) -> None:
        """Создание коллекции"""
        pass
    
    @abstractmethod
    async def delete_collection(self, collection_name: str) -> None:
        """Удаление коллекции"""
        pass
    
    @abstractmethod
    async def upsert(
        self,
        collection_name: str,
        points: List[Dict[str, Any]]
    ) -> int:
        """Вставка/обновление точек"""
        pass
    
    @abstractmethod
    async def search(
        self,
        collection_name: str,
        query_vector: List[float],
        limit: int = 10,
        query_filter: Optional[Dict] = None
    ) -> List[VectorSearchResult]:
        """Поиск ближайших векторов"""
        pass
    
    @abstractmethod
    async def delete(
        self,
        collection_name: str,
        ids: List[str]
    ) -> int:
        """Удаление точек по ID"""
        pass


class QdrantVectorStore(VectorStore):
    """
    Клиент для Qdrant
    
    Требует: pip install qdrant-client
    """
    
    def __init__(self, host: str = "localhost", port: int = 6333, api_key: Optional[str] = None):
        self.host = host
        self.port = port
        self.api_key = api_key
        self._client = None
    
    def _get_client(self):
        """Ленивая инициализация клиента"""
        if self._client is None:
            try:
                from qdrant_client import QdrantClient
                from qdrant_client.http import models
                
                self._client = QdrantClient(
                    host=self.host,
                    port=self.port,
                    api_key=self.api_key
                )
                self._models = models
            except ImportError:
                raise ImportError(
                    "qdrant-client not installed. "
                    "Run: pip install qdrant-client"
                )
        return self._client
    
    async def create_collection(
        self,
        collection_name: str,
        dimension: int,
        distance: str = "cosine"
    ) -> None:
        client = self._get_client()
        
        distance_map = {
            "cosine": self._models.Distance.COSINE,
            "euclidean": self._models.Distance.EUCLID,
            "dot": self._models.Distance.DOT,
        }
        
        client.create_collection(
            collection_name=collection_name,
            vectors_config=self._models.VectorParams(
                size=dimension,
                distance=distance_map.get(distance, self._models.Distance.COSINE)
            )
        )
    
    async def delete_collection(self, collection_name: str) -> None:
        client = self._get_client()
        client.delete_collection(collection_name)
    
    async def upsert(
        self,
        collection_name: str,
        points: List[Dict[str, Any]]
    ) -> int:
        client = self._get_client()
        
        qdrant_points = [
            self._models.PointStruct(
                id=p["id"],
                vector=p["vector"],
                payload=p.get("payload", {})
            )
            for p in points
        ]
        
        client.upsert(
            collection_name=collection_name,
            points=qdrant_points
        )
        
        return len(points)
    
    async def search(
        self,
        collection_name: str,
        query_vector: List[float],
        limit: int = 10,
        query_filter: Optional[Dict] = None
    ) -> List[VectorSearchResult]:
        client = self._get_client()
        
        # Конвертируем фильтр
        qdrant_filter = None
        if query_filter:
            qdrant_filter = self._build_filter(query_filter)
        
        results = client.search(
            collection_name=collection_name,
            query_vector=query_vector,
            limit=limit,
            query_filter=qdrant_filter
        )
        
        return [
            VectorSearchResult(
                id=str(hit.id),
                score=hit.score,
                payload=hit.payload or {}
            )
            for hit in results
        ]
    
    async def delete(
        self,
        collection_name: str,
        ids: List[str]
    ) -> int:
        client = self._get_client()
        
        client.delete(
            collection_name=collection_name,
            points_selector=self._models.PointIdsList(points=ids)
        )
        
        return len(ids)
    
    def _build_filter(self, query_filter: Dict) -> Any:
        """Построение фильтра Qdrant"""
        conditions = []
        
        for condition in query_filter.get("must", []):
            if "match" in condition:
                conditions.append(
                    self._models.FieldCondition(
                        key=condition["key"],
                        match=self._models.MatchValue(value=condition["match"]["value"])
                    )
                )
            elif "range" in condition:
                range_params = {}
                if "gte" in condition["range"]:
                    range_params["gte"] = condition["range"]["gte"]
                if "lte" in condition["range"]:
                    range_params["lte"] = condition["range"]["lte"]
                conditions.append(
                    self._models.FieldCondition(
                        key=condition["key"],
                        range=self._models.Range(**range_params)
                    )
                )
        
        if conditions:
            return self._models.Filter(must=conditions)
        return None


class RedisVectorStore(VectorStore):
    """
    Клиент для Redis Stack (Vector Search)
    
    Требует: Redis Stack с модулем RediSearch
    """
    
    def __init__(self, redis_client):
        self.redis = redis_client
    
    async def create_collection(
        self,
        collection_name: str,
        dimension: int,
        distance: str = "cosine"
    ) -> None:
        """
        Создание индекса в Redis
        
        FT.CREATE idx:products ON HASH PREFIX 1 "product:" SCHEMA
            name TEXT
            embedding VECTOR HNSW 6 TYPE FLOAT32 DIM 768 DISTANCE_METRIC COSINE
        """
        distance_map = {
            "cosine": "COSINE",
            "euclidean": "L2",
            "dot": "IP"
        }
        
        index_name = f"idx:{collection_name}"
        prefix = f"{collection_name}:"
        
        try:
            await self.redis.execute_command(
                "FT.CREATE", index_name,
                "ON", "HASH",
                "PREFIX", "1", prefix,
                "SCHEMA",
                "name", "TEXT",
                "price", "NUMERIC",
                "in_stock", "TAG",
                "category", "TAG",
                "embedding", "VECTOR", "HNSW", "6",
                "TYPE", "FLOAT32",
                "DIM", str(dimension),
                "DISTANCE_METRIC", distance_map.get(distance, "COSINE")
            )
        except Exception as e:
            if "Index already exists" not in str(e):
                raise
    
    async def delete_collection(self, collection_name: str) -> None:
        index_name = f"idx:{collection_name}"
        try:
            await self.redis.execute_command("FT.DROPINDEX", index_name, "DD")
        except Exception:
            pass
    
    async def upsert(
        self,
        collection_name: str,
        points: List[Dict[str, Any]]
    ) -> int:
        prefix = f"{collection_name}:"
        
        for point in points:
            key = f"{prefix}{point['id']}"
            vector_bytes = np.array(point["vector"], dtype=np.float32).tobytes()
            
            payload = point.get("payload", {})
            
            await self.redis.hset(key, mapping={
                "id": point["id"],
                "name": payload.get("name", ""),
                "price": payload.get("price", 0),
                "in_stock": "true" if payload.get("in_stock", True) else "false",
                "category": payload.get("category", ""),
                "brand": payload.get("brand", ""),
                "url": payload.get("url", ""),
                "image": payload.get("image", ""),
                "embedding": vector_bytes
            })
        
        return len(points)
    
    async def search(
        self,
        collection_name: str,
        query_vector: List[float],
        limit: int = 10,
        query_filter: Optional[Dict] = None
    ) -> List[VectorSearchResult]:
        """
        Векторный поиск в Redis
        
        FT.SEARCH idx:products "*=>[KNN 10 @embedding $vec AS score]"
            PARAMS 2 vec <vector_bytes>
            SORTBY score
            DIALECT 2
        """
        index_name = f"idx:{collection_name}"
        vector_bytes = np.array(query_vector, dtype=np.float32).tobytes()
        
        # Базовый запрос
        query = f"*=>[KNN {limit} @embedding $vec AS score]"
        
        # Добавляем фильтры
        if query_filter:
            filter_parts = []
            for condition in query_filter.get("must", []):
                if "match" in condition:
                    key = condition["key"]
                    value = condition["match"]["value"]
                    if isinstance(value, bool):
                        value = "true" if value else "false"
                    filter_parts.append(f"@{key}:{{{value}}}")
                elif "range" in condition:
                    key = condition["key"]
                    gte = condition["range"].get("gte", "-inf")
                    lte = condition["range"].get("lte", "+inf")
                    filter_parts.append(f"@{key}:[{gte} {lte}]")
            
            if filter_parts:
                filter_str = " ".join(filter_parts)
                query = f"({filter_str})=>[KNN {limit} @embedding $vec AS score]"
        
        results = await self.redis.execute_command(
            "FT.SEARCH", index_name, query,
            "PARAMS", "2", "vec", vector_bytes,
            "SORTBY", "score",
            "DIALECT", "2",
            "RETURN", "8", "id", "name", "price", "in_stock", "category", "brand", "url", "image"
        )
        
        # Парсим результаты
        search_results = []
        if results and len(results) > 1:
            # results[0] = total count
            # results[1], results[2] = key, fields
            # ...
            for i in range(1, len(results), 2):
                if i + 1 < len(results):
                    key = results[i]
                    fields = results[i + 1]
                    
                    payload = {}
                    score = 0.0
                    
                    for j in range(0, len(fields), 2):
                        field_name = fields[j]
                        field_value = fields[j + 1]
                        
                        if field_name == "score":
                            score = float(field_value)
                        elif field_name == "price":
                            payload[field_name] = float(field_value) if field_value else 0
                        elif field_name == "in_stock":
                            payload[field_name] = field_value == "true"
                        else:
                            payload[field_name] = field_value
                    
                    search_results.append(VectorSearchResult(
                        id=payload.get("id", key.split(":")[-1]),
                        score=1.0 - score,  # Redis возвращает distance, конвертируем в similarity
                        payload=payload
                    ))
        
        return search_results
    
    async def delete(
        self,
        collection_name: str,
        ids: List[str]
    ) -> int:
        prefix = f"{collection_name}:"
        
        for id in ids:
            key = f"{prefix}{id}"
            await self.redis.delete(key)
        
        return len(ids)


class InMemoryVectorStore(VectorStore):
    """
    In-memory vector store для тестирования и небольших коллекций
    """
    
    def __init__(self):
        self.collections: Dict[str, Dict[str, Dict]] = {}
    
    async def create_collection(
        self,
        collection_name: str,
        dimension: int,
        distance: str = "cosine"
    ) -> None:
        if collection_name not in self.collections:
            self.collections[collection_name] = {
                "dimension": dimension,
                "distance": distance,
                "points": {}
            }
    
    async def delete_collection(self, collection_name: str) -> None:
        if collection_name in self.collections:
            del self.collections[collection_name]
    
    async def upsert(
        self,
        collection_name: str,
        points: List[Dict[str, Any]]
    ) -> int:
        if collection_name not in self.collections:
            raise ValueError(f"Collection {collection_name} not found")
        
        for point in points:
            self.collections[collection_name]["points"][point["id"]] = {
                "vector": np.array(point["vector"], dtype=np.float32),
                "payload": point.get("payload", {})
            }
        
        return len(points)
    
    async def search(
        self,
        collection_name: str,
        query_vector: List[float],
        limit: int = 10,
        query_filter: Optional[Dict] = None
    ) -> List[VectorSearchResult]:
        if collection_name not in self.collections:
            return []
        
        collection = self.collections[collection_name]
        query_vec = np.array(query_vector, dtype=np.float32)
        
        # Normalize query vector
        query_vec = query_vec / np.linalg.norm(query_vec)
        
        results = []
        for point_id, point_data in collection["points"].items():
            # Apply filters
            if query_filter and not self._match_filter(point_data["payload"], query_filter):
                continue
            
            # Calculate cosine similarity
            point_vec = point_data["vector"]
            point_vec = point_vec / np.linalg.norm(point_vec)
            score = float(np.dot(query_vec, point_vec))
            
            results.append(VectorSearchResult(
                id=point_id,
                score=score,
                payload=point_data["payload"]
            ))
        
        # Sort by score descending
        results.sort(key=lambda x: x.score, reverse=True)
        
        return results[:limit]
    
    async def delete(
        self,
        collection_name: str,
        ids: List[str]
    ) -> int:
        if collection_name not in self.collections:
            return 0
        
        deleted = 0
        for id in ids:
            if id in self.collections[collection_name]["points"]:
                del self.collections[collection_name]["points"][id]
                deleted += 1
        
        return deleted
    
    def _match_filter(self, payload: Dict, query_filter: Dict) -> bool:
        """Проверка соответствия фильтру"""
        for condition in query_filter.get("must", []):
            key = condition.get("key")
            
            if "match" in condition:
                expected = condition["match"]["value"]
                actual = payload.get(key)
                if actual != expected:
                    return False
            
            elif "range" in condition:
                actual = payload.get(key, 0)
                if "gte" in condition["range"] and actual < condition["range"]["gte"]:
                    return False
                if "lte" in condition["range"] and actual > condition["range"]["lte"]:
                    return False
        
        return True


def create_vector_store(
    store_type: str = "memory",
    **kwargs
) -> VectorStore:
    """
    Фабрика для создания vector store
    
    Args:
        store_type: "memory", "qdrant", "redis"
        **kwargs: параметры для конкретного store
    """
    if store_type == "memory":
        return InMemoryVectorStore()
    elif store_type == "qdrant":
        return QdrantVectorStore(
            host=kwargs.get("host", "localhost"),
            port=kwargs.get("port", 6333),
            api_key=kwargs.get("api_key")
        )
    elif store_type == "redis":
        return RedisVectorStore(kwargs["redis_client"])
    else:
        raise ValueError(f"Unknown vector store type: {store_type}")
