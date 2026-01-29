"""
Embeddings - векторные представления текста

Модели:
- multilingual-e5-base: лучшее качество для мультиязычного поиска
- rubert-tiny2: быстрая модель для русского языка
- paraphrase-multilingual-MiniLM: баланс скорости и качества
"""
import numpy as np
from typing import List, Optional, Union, Dict, Any
from dataclasses import dataclass
from abc import ABC, abstractmethod
import hashlib
import json


@dataclass
class EmbeddingConfig:
    """Конфигурация модели embeddings"""
    model_name: str = "intfloat/multilingual-e5-base"
    dimension: int = 768
    max_length: int = 512
    batch_size: int = 32
    normalize: bool = True
    device: str = "cpu"  # cpu, cuda, cuda:0
    cache_enabled: bool = True
    prefix_query: str = "query: "  # Для E5 моделей
    prefix_passage: str = "passage: "


class EmbeddingModel(ABC):
    """Абстрактный класс для моделей embeddings"""
    
    @abstractmethod
    def encode(
        self, 
        texts: Union[str, List[str]], 
        is_query: bool = True
    ) -> np.ndarray:
        """
        Кодирование текста в вектор
        
        Args:
            texts: Текст или список текстов
            is_query: True для запросов, False для документов
            
        Returns:
            Numpy массив embeddings [n_texts, dimension]
        """
        pass
    
    @property
    @abstractmethod
    def dimension(self) -> int:
        """Размерность векторов"""
        pass


class SentenceTransformerModel(EmbeddingModel):
    """
    Модель на базе sentence-transformers
    
    Поддерживаемые модели:
    - intfloat/multilingual-e5-base (768 dims, лучшее качество)
    - intfloat/multilingual-e5-small (384 dims, быстрее)
    - sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2 (384 dims)
    - cointegrated/rubert-tiny2 (312 dims, очень быстрая)
    """
    
    def __init__(self, config: EmbeddingConfig):
        self.config = config
        self._model = None
        self._dimension = config.dimension
    
    def _load_model(self):
        """Ленивая загрузка модели"""
        if self._model is None:
            try:
                from sentence_transformers import SentenceTransformer
                
                self._model = SentenceTransformer(
                    self.config.model_name,
                    device=self.config.device
                )
                
                # Обновляем реальную размерность
                self._dimension = self._model.get_sentence_embedding_dimension()
                
            except ImportError:
                raise ImportError(
                    "sentence-transformers not installed. "
                    "Run: pip install sentence-transformers"
                )
    
    def encode(
        self, 
        texts: Union[str, List[str]], 
        is_query: bool = True
    ) -> np.ndarray:
        """
        Кодирование текста в embedding
        """
        self._load_model()
        
        # Нормализуем входные данные
        if isinstance(texts, str):
            texts = [texts]
        
        # Добавляем префиксы для E5 моделей
        if "e5" in self.config.model_name.lower():
            prefix = self.config.prefix_query if is_query else self.config.prefix_passage
            texts = [prefix + t for t in texts]
        
        # Кодируем батчами
        embeddings = self._model.encode(
            texts,
            batch_size=self.config.batch_size,
            normalize_embeddings=self.config.normalize,
            show_progress_bar=False,
            convert_to_numpy=True
        )
        
        return embeddings
    
    @property
    def dimension(self) -> int:
        return self._dimension


class MockEmbeddingModel(EmbeddingModel):
    """
    Mock модель для тестирования (без реальной нейросети)
    Генерирует детерминированные псевдо-embeddings на основе хэша текста
    """
    
    def __init__(self, dimension: int = 384):
        self._dimension = dimension
    
    def encode(
        self, 
        texts: Union[str, List[str]], 
        is_query: bool = True
    ) -> np.ndarray:
        if isinstance(texts, str):
            texts = [texts]
        
        embeddings = []
        for text in texts:
            # Генерируем псевдо-случайный вектор на основе хэша
            hash_bytes = hashlib.sha256(text.encode()).digest()
            # Расширяем до нужной размерности
            np.random.seed(int.from_bytes(hash_bytes[:4], 'big'))
            embedding = np.random.randn(self._dimension).astype(np.float32)
            # Нормализуем
            embedding = embedding / np.linalg.norm(embedding)
            embeddings.append(embedding)
        
        return np.array(embeddings)
    
    @property
    def dimension(self) -> int:
        return self._dimension


class EmbeddingService:
    """
    Сервис для работы с embeddings
    
    Возможности:
    - Кэширование embeddings
    - Батчевая обработка
    - Асинхронная генерация
    """
    
    def __init__(
        self, 
        model: EmbeddingModel,
        redis_client=None,
        cache_ttl: int = 86400 * 7  # 7 дней
    ):
        self.model = model
        self.redis = redis_client
        self.cache_ttl = cache_ttl
    
    async def encode_query(self, query: str) -> np.ndarray:
        """
        Кодирование поискового запроса
        """
        # Для запросов обычно не кэшируем (они уникальны)
        embedding = self.model.encode(query, is_query=True)
        return embedding[0]  # Возвращаем 1D массив
    
    async def encode_products(
        self, 
        products: List[Dict[str, Any]],
        text_field: str = "search_text"
    ) -> Dict[str, np.ndarray]:
        """
        Кодирование товаров с кэшированием
        
        Args:
            products: Список товаров
            text_field: Поле для извлечения текста
            
        Returns:
            Словарь {product_id: embedding}
        """
        result = {}
        to_encode = []
        to_encode_ids = []
        
        for product in products:
            product_id = product["id"]
            text = self._get_product_text(product, text_field)
            
            # Проверяем кэш
            cached = await self._get_cached_embedding(product_id, text)
            if cached is not None:
                result[product_id] = cached
            else:
                to_encode.append(text)
                to_encode_ids.append(product_id)
        
        # Кодируем некэшированные
        if to_encode:
            embeddings = self.model.encode(to_encode, is_query=False)
            
            for i, product_id in enumerate(to_encode_ids):
                embedding = embeddings[i]
                result[product_id] = embedding
                
                # Сохраняем в кэш
                await self._cache_embedding(product_id, to_encode[i], embedding)
        
        return result
    
    def _get_product_text(self, product: Dict, text_field: str) -> str:
        """
        Извлечение текста для embedding из товара
        """
        if text_field in product and product[text_field]:
            return product[text_field]
        
        # Собираем из полей
        parts = []
        
        if product.get("name"):
            parts.append(product["name"])
        
        if product.get("brand"):
            parts.append(product["brand"])
        
        if product.get("category"):
            parts.append(product["category"])
        
        if product.get("description"):
            # Ограничиваем описание
            desc = product["description"][:500]
            parts.append(desc)
        
        return " ".join(parts)
    
    async def _get_cached_embedding(
        self, 
        product_id: str, 
        text: str
    ) -> Optional[np.ndarray]:
        """Получение embedding из кэша"""
        if not self.redis:
            return None
        
        # Ключ включает хэш текста для инвалидации при изменении
        text_hash = hashlib.md5(text.encode()).hexdigest()[:8]
        cache_key = f"emb:{product_id}:{text_hash}"
        
        data = await self.redis.get(cache_key)
        if data:
            return np.frombuffer(data, dtype=np.float32)
        
        return None
    
    async def _cache_embedding(
        self, 
        product_id: str, 
        text: str, 
        embedding: np.ndarray
    ):
        """Сохранение embedding в кэш"""
        if not self.redis:
            return
        
        text_hash = hashlib.md5(text.encode()).hexdigest()[:8]
        cache_key = f"emb:{product_id}:{text_hash}"
        
        await self.redis.setex(
            cache_key,
            self.cache_ttl,
            embedding.astype(np.float32).tobytes()
        )
    
    def compute_similarity(
        self, 
        query_embedding: np.ndarray, 
        product_embeddings: np.ndarray
    ) -> np.ndarray:
        """
        Вычисление косинусного сходства
        
        Args:
            query_embedding: [dimension]
            product_embeddings: [n_products, dimension]
            
        Returns:
            Массив scores [n_products]
        """
        # Для нормализованных векторов cosine similarity = dot product
        if len(query_embedding.shape) == 1:
            query_embedding = query_embedding.reshape(1, -1)
        
        scores = np.dot(product_embeddings, query_embedding.T).flatten()
        return scores


def create_embedding_model(
    model_name: str = "auto",
    device: str = "cpu",
    use_mock: bool = False
) -> EmbeddingModel:
    """
    Фабрика для создания модели embeddings
    
    Args:
        model_name: Название модели или "auto" для автовыбора
        device: Устройство (cpu, cuda)
        use_mock: Использовать mock модель (для тестов)
    
    Returns:
        EmbeddingModel instance
    """
    if use_mock:
        return MockEmbeddingModel(dimension=384)
    
    # Автовыбор модели
    if model_name == "auto":
        try:
            import torch
            if torch.cuda.is_available():
                model_name = "intfloat/multilingual-e5-base"
                device = "cuda"
            else:
                model_name = "cointegrated/rubert-tiny2"
        except ImportError:
            model_name = "cointegrated/rubert-tiny2"
    
    # Определяем размерность
    dimension_map = {
        "intfloat/multilingual-e5-base": 768,
        "intfloat/multilingual-e5-small": 384,
        "intfloat/multilingual-e5-large": 1024,
        "cointegrated/rubert-tiny2": 312,
        "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2": 384,
    }
    
    dimension = dimension_map.get(model_name, 768)
    
    config = EmbeddingConfig(
        model_name=model_name,
        dimension=dimension,
        device=device
    )
    
    return SentenceTransformerModel(config)
