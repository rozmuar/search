"""
Интерфейсы (абстрактные классы) сервиса поиска
"""
from abc import ABC, abstractmethod
from typing import List, Optional, Dict, Any
from .models import (
    Product, SearchResult, SuggestResult, SearchQuery,
    Feed, FeedLog, Project, Synonym
)


class ISearchEngine(ABC):
    """Интерфейс поискового движка"""
    
    @abstractmethod
    async def search(
        self,
        project_id: str,
        query: str,
        limit: int = 20,
        offset: int = 0,
        filters: Optional[Dict[str, Any]] = None,
        sort: str = "relevance"
    ) -> SearchResult:
        """
        Выполнить поиск товаров
        
        Args:
            project_id: ID проекта
            query: Поисковый запрос
            limit: Количество результатов
            offset: Смещение для пагинации
            filters: Фильтры (price_min, price_max, in_stock, category, etc.)
            sort: Сортировка (relevance, price_asc, price_desc, popular)
        
        Returns:
            SearchResult с товарами и метаданными
        """
        pass
    
    @abstractmethod
    async def suggest(
        self,
        project_id: str,
        prefix: str,
        limit: int = 10,
        include_products: bool = True,
        include_categories: bool = True
    ) -> SuggestResult:
        """
        Получить подсказки для автодополнения
        
        Args:
            project_id: ID проекта
            prefix: Префикс для поиска
            limit: Количество подсказок
            include_products: Включить товары
            include_categories: Включить категории
        
        Returns:
            SuggestResult с подсказками
        """
        pass
    
    @abstractmethod
    async def get_product(
        self,
        project_id: str,
        product_id: str
    ) -> Optional[Product]:
        """Получить товар по ID"""
        pass
    
    @abstractmethod
    async def get_similar_products(
        self,
        project_id: str,
        product_id: str,
        limit: int = 10
    ) -> List[Product]:
        """Получить похожие товары"""
        pass


class IQueryProcessor(ABC):
    """Интерфейс обработчика запросов"""
    
    @abstractmethod
    def process(self, query: str, project_id: str) -> SearchQuery:
        """
        Обработать поисковый запрос
        
        Этапы:
        1. Нормализация (lowercase, удаление спецсимволов)
        2. Токенизация
        3. Исправление опечаток
        4. Применение синонимов
        
        Returns:
            SearchQuery с обработанными токенами
        """
        pass
    
    @abstractmethod
    def normalize(self, query: str) -> str:
        """Нормализация запроса"""
        pass
    
    @abstractmethod
    def tokenize(self, query: str) -> List[str]:
        """Разбить на токены"""
        pass
    
    @abstractmethod
    def fix_typos(self, tokens: List[str], project_id: str) -> List[str]:
        """Исправить опечатки"""
        pass
    
    @abstractmethod
    def expand_synonyms(self, tokens: List[str], project_id: str) -> List[List[str]]:
        """Расширить синонимами"""
        pass


class IIndexer(ABC):
    """Интерфейс индексатора"""
    
    @abstractmethod
    async def index_products(
        self,
        project_id: str,
        products: List[Product]
    ) -> int:
        """
        Индексировать товары (полная переиндексация)
        
        Returns:
            Количество проиндексированных товаров
        """
        pass
    
    @abstractmethod
    async def update_products(
        self,
        project_id: str,
        products: List[Product]
    ) -> int:
        """
        Обновить товары (частичное обновление)
        
        Returns:
            Количество обновлённых товаров
        """
        pass
    
    @abstractmethod
    async def update_stock_prices(
        self,
        project_id: str,
        updates: List[Dict[str, Any]]
    ) -> int:
        """
        Быстрое обновление остатков и цен (для delta-фида)
        
        Args:
            updates: Список с {id, price, old_price, in_stock, quantity}
        
        Returns:
            Количество обновлённых товаров
        """
        pass
    
    @abstractmethod
    async def delete_products(
        self,
        project_id: str,
        product_ids: List[str]
    ) -> int:
        """Удалить товары из индекса"""
        pass
    
    @abstractmethod
    async def clear_index(self, project_id: str) -> None:
        """Очистить весь индекс проекта"""
        pass


class IFeedProcessor(ABC):
    """Интерфейс обработчика фидов"""
    
    @abstractmethod
    async def process_full_feed(
        self,
        feed: Feed
    ) -> FeedLog:
        """
        Обработать полный фид
        
        1. Загрузить фид
        2. Распарсить
        3. Валидировать
        4. Переиндексировать все товары
        """
        pass
    
    @abstractmethod
    async def process_delta_feed(
        self,
        feed: Feed
    ) -> FeedLog:
        """
        Обработать delta-фид (остатки и цены)
        
        1. Загрузить фид
        2. Распарсить
        3. Обновить только цены и остатки
        """
        pass
    
    @abstractmethod
    async def download_feed(self, url: str) -> bytes:
        """Загрузить содержимое фида"""
        pass
    
    @abstractmethod
    def parse_feed(
        self,
        content: bytes,
        format: str
    ) -> List[Dict[str, Any]]:
        """Распарсить фид"""
        pass
    
    @abstractmethod
    def validate_products(
        self,
        products: List[Dict]
    ) -> tuple[List[Dict], List[Dict]]:
        """
        Валидировать товары
        
        Returns:
            (valid_products, errors)
        """
        pass


class ICache(ABC):
    """Интерфейс кэша"""
    
    @abstractmethod
    async def get_search_result(
        self,
        project_id: str,
        query_hash: str
    ) -> Optional[SearchResult]:
        """Получить закэшированный результат поиска"""
        pass
    
    @abstractmethod
    async def set_search_result(
        self,
        project_id: str,
        query_hash: str,
        result: SearchResult,
        ttl: int = 60
    ) -> None:
        """Сохранить результат поиска в кэш"""
        pass
    
    @abstractmethod
    async def invalidate_by_products(
        self,
        project_id: str,
        product_ids: List[str]
    ) -> int:
        """
        Инвалидировать кэш для изменённых товаров
        
        Returns:
            Количество удалённых записей
        """
        pass
    
    @abstractmethod
    async def invalidate_project(self, project_id: str) -> None:
        """Очистить весь кэш проекта"""
        pass


class IAnalytics(ABC):
    """Интерфейс аналитики"""
    
    @abstractmethod
    async def track_search(
        self,
        project_id: str,
        query: str,
        results_count: int,
        session_id: Optional[str] = None
    ) -> None:
        """Записать поисковый запрос"""
        pass
    
    @abstractmethod
    async def track_click(
        self,
        project_id: str,
        query: str,
        product_id: str,
        position: int,
        session_id: Optional[str] = None
    ) -> None:
        """Записать клик по товару"""
        pass
    
    @abstractmethod
    async def track_conversion(
        self,
        project_id: str,
        order_id: str,
        products: List[Dict],
        total: float,
        search_query: Optional[str] = None
    ) -> None:
        """Записать конверсию (покупку)"""
        pass
    
    @abstractmethod
    async def get_popular_queries(
        self,
        project_id: str,
        period: str = "day",
        limit: int = 100
    ) -> List[Dict]:
        """Получить популярные запросы"""
        pass
    
    @abstractmethod
    async def get_zero_result_queries(
        self,
        project_id: str,
        period: str = "day",
        limit: int = 100
    ) -> List[Dict]:
        """Получить запросы без результатов"""
        pass


class IProjectRepository(ABC):
    """Интерфейс репозитория проектов"""
    
    @abstractmethod
    async def get_by_id(self, project_id: str) -> Optional[Project]:
        pass
    
    @abstractmethod
    async def get_by_api_key(self, api_key: str) -> Optional[Project]:
        pass
    
    @abstractmethod
    async def create(self, project: Project) -> Project:
        pass
    
    @abstractmethod
    async def update(self, project: Project) -> Project:
        pass
    
    @abstractmethod
    async def delete(self, project_id: str) -> None:
        pass


class IFeedRepository(ABC):
    """Интерфейс репозитория фидов"""
    
    @abstractmethod
    async def get_by_id(self, feed_id: str) -> Optional[Feed]:
        pass
    
    @abstractmethod
    async def get_by_project(self, project_id: str) -> List[Feed]:
        pass
    
    @abstractmethod
    async def get_pending_feeds(self) -> List[Feed]:
        """Получить фиды, требующие обновления"""
        pass
    
    @abstractmethod
    async def create(self, feed: Feed) -> Feed:
        pass
    
    @abstractmethod
    async def update(self, feed: Feed) -> Feed:
        pass
    
    @abstractmethod
    async def delete(self, feed_id: str) -> None:
        pass


class ISynonymRepository(ABC):
    """Интерфейс репозитория синонимов"""
    
    @abstractmethod
    async def get_by_project(self, project_id: str) -> List[Synonym]:
        pass
    
    @abstractmethod
    async def get_synonyms_dict(self, project_id: str) -> Dict[str, List[str]]:
        """Получить словарь синонимов {word: [synonyms]}"""
        pass
    
    @abstractmethod
    async def set_synonyms(
        self,
        project_id: str,
        synonyms: List[Synonym]
    ) -> None:
        """Установить синонимы (заменяет существующие)"""
        pass
