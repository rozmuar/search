"""
Neural Re-ranker - переранжирование результатов с помощью cross-encoder

Cross-encoder оценивает релевантность пары (query, document) напрямую,
что даёт более точные результаты, чем bi-encoder (embeddings).

Модели:
- cross-encoder/ms-marco-MiniLM-L-6-v2 (быстрая, английский)
- BAAI/bge-reranker-base (мультиязычная)
- jeffwan/mmarco-mMiniLMv2-L12-H384-v1 (мультиязычная)
"""
import numpy as np
from typing import List, Tuple, Optional, Dict, Any
from dataclasses import dataclass
from abc import ABC, abstractmethod


@dataclass
class RerankerConfig:
    """Конфигурация re-ranker"""
    model_name: str = "BAAI/bge-reranker-base"
    max_length: int = 512
    batch_size: int = 32
    device: str = "cpu"
    top_k: int = 20  # Сколько результатов переранжировать


class NeuralReranker(ABC):
    """Абстрактный класс для neural re-ranker"""
    
    @abstractmethod
    def rerank(
        self,
        query: str,
        documents: List[str],
        top_k: Optional[int] = None
    ) -> List[Tuple[int, float]]:
        """
        Переранжирование документов
        
        Args:
            query: Поисковый запрос
            documents: Список документов (текстов)
            top_k: Вернуть топ-K результатов
            
        Returns:
            Список (original_index, score) отсортированный по score desc
        """
        pass


class CrossEncoderReranker(NeuralReranker):
    """
    Re-ranker на базе cross-encoder
    
    Cross-encoder принимает пару (query, document) и возвращает score релевантности.
    Более точный, но медленнее чем bi-encoder.
    """
    
    def __init__(self, config: RerankerConfig):
        self.config = config
        self._model = None
    
    def _load_model(self):
        """Ленивая загрузка модели"""
        if self._model is None:
            try:
                from sentence_transformers import CrossEncoder
                
                self._model = CrossEncoder(
                    self.config.model_name,
                    max_length=self.config.max_length,
                    device=self.config.device
                )
                
            except ImportError:
                raise ImportError(
                    "sentence-transformers not installed. "
                    "Run: pip install sentence-transformers"
                )
    
    def rerank(
        self,
        query: str,
        documents: List[str],
        top_k: Optional[int] = None
    ) -> List[Tuple[int, float]]:
        """
        Переранжирование документов с помощью cross-encoder
        """
        if not documents:
            return []
        
        self._load_model()
        
        top_k = top_k or self.config.top_k
        
        # Формируем пары (query, document)
        pairs = [(query, doc) for doc in documents]
        
        # Получаем scores
        scores = self._model.predict(
            pairs,
            batch_size=self.config.batch_size,
            show_progress_bar=False
        )
        
        # Создаём список (index, score) и сортируем
        indexed_scores = list(enumerate(scores))
        indexed_scores.sort(key=lambda x: x[1], reverse=True)
        
        # Возвращаем top_k
        return indexed_scores[:top_k]
    
    def rerank_products(
        self,
        query: str,
        products: List[Dict[str, Any]],
        text_field: str = "name",
        top_k: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """
        Переранжирование списка товаров
        
        Args:
            query: Поисковый запрос
            products: Список товаров
            text_field: Поле для сравнения (name, description, etc.)
            top_k: Вернуть топ-K
            
        Returns:
            Переранжированный список товаров с добавленным rerank_score
        """
        if not products:
            return []
        
        # Извлекаем тексты
        documents = []
        for product in products:
            text = self._get_product_text(product, text_field)
            documents.append(text)
        
        # Переранжируем
        reranked = self.rerank(query, documents, top_k)
        
        # Возвращаем товары в новом порядке
        result = []
        for original_idx, score in reranked:
            product = products[original_idx].copy()
            product["rerank_score"] = float(score)
            result.append(product)
        
        return result
    
    def _get_product_text(self, product: Dict, text_field: str) -> str:
        """Извлечение текста для ранжирования"""
        parts = []
        
        # Основное поле
        if text_field in product:
            parts.append(str(product[text_field]))
        
        # Добавляем название, если это не основное поле
        if text_field != "name" and product.get("name"):
            parts.append(product["name"])
        
        # Добавляем бренд
        if product.get("brand"):
            parts.append(product["brand"])
        
        # Добавляем категорию
        if product.get("category"):
            parts.append(product["category"])
        
        return " | ".join(parts)


class MockReranker(NeuralReranker):
    """
    Mock re-ranker для тестирования
    Просто возвращает документы в исходном порядке с убывающим score
    """
    
    def rerank(
        self,
        query: str,
        documents: List[str],
        top_k: Optional[int] = None
    ) -> List[Tuple[int, float]]:
        top_k = top_k or 20
        
        # Простая эвристика: score зависит от наличия слов запроса
        query_words = set(query.lower().split())
        
        scores = []
        for i, doc in enumerate(documents):
            doc_words = set(doc.lower().split())
            overlap = len(query_words & doc_words)
            score = overlap / max(len(query_words), 1) + (1.0 / (i + 1))  # Decay by position
            scores.append((i, score))
        
        scores.sort(key=lambda x: x[1], reverse=True)
        return scores[:top_k]


def create_reranker(
    model_name: str = "auto",
    device: str = "cpu",
    use_mock: bool = False
) -> NeuralReranker:
    """
    Фабрика для создания re-ranker
    
    Args:
        model_name: Название модели или "auto"
        device: Устройство (cpu, cuda)
        use_mock: Использовать mock (для тестов)
    """
    if use_mock:
        return MockReranker()
    
    if model_name == "auto":
        model_name = "BAAI/bge-reranker-base"
    
    config = RerankerConfig(
        model_name=model_name,
        device=device
    )
    
    return CrossEncoderReranker(config)
