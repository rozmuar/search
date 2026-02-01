"""
Модели данных для сервиса поиска
"""
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, List, Dict, Any
from enum import Enum


class FeedType(Enum):
    FULL = "full"
    DELTA = "delta"


class FeedFormat(Enum):
    XML = "xml"
    JSON = "json"
    CSV = "csv"


class FeedStatus(Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    SUCCESS = "success"
    ERROR = "error"


class ProjectStatus(Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    DELETED = "deleted"


@dataclass
class User:
    """Пользователь системы"""
    id: str
    email: str
    password_hash: str
    name: Optional[str] = None
    created_at: datetime = field(default_factory=datetime.now)


@dataclass
class Project:
    """Проект (сайт клиента)"""
    id: str
    user_id: str
    name: str
    domain: str
    api_key: str
    status: ProjectStatus = ProjectStatus.ACTIVE
    settings: Dict[str, Any] = field(default_factory=dict)
    created_at: datetime = field(default_factory=datetime.now)
    
    # Настройки по умолчанию
    DEFAULT_SETTINGS = {
        "language": "ru",
        "currency": "RUB",
        "search": {
            "min_chars": 2,
            "results_per_page": 20,
            "highlight_matches": True,
        },
        "suggestions": {
            "enabled": True,
            "limit": 10,
            "show_products": True,
            "products_limit": 4,
        }
    }


@dataclass
class Feed:
    """Фид товаров"""
    id: str
    project_id: str
    type: FeedType
    url: str
    format: FeedFormat = FeedFormat.XML
    update_interval: int = 3600  # секунды
    last_update: Optional[datetime] = None
    last_status: FeedStatus = FeedStatus.PENDING
    last_error: Optional[str] = None
    items_count: int = 0
    created_at: datetime = field(default_factory=datetime.now)


@dataclass
class Product:
    """Товар в индексе"""
    id: str
    name: str
    url: str
    
    # Опциональные поля
    description: Optional[str] = None
    image: Optional[str] = None
    images: List[str] = field(default_factory=list)
    price: float = 0.0
    old_price: Optional[float] = None
    currency: str = "RUB"
    in_stock: bool = True
    quantity: Optional[int] = None
    category: Optional[str] = None
    categories: List[str] = field(default_factory=list)
    brand: Optional[str] = None
    vendor_code: Optional[str] = None  # Артикул товара
    params: Dict[str, str] = field(default_factory=dict)  # Параметры из фида
    attributes: Dict[str, Any] = field(default_factory=dict)
    
    # Вычисляемые поля
    discount_percent: Optional[int] = None
    search_text: str = ""
    tokens: List[str] = field(default_factory=list)
    popularity: float = 0.0
    
    def __post_init__(self):
        # Вычисляем скидку
        if self.old_price and self.price and self.old_price > self.price:
            self.discount_percent = round((1 - self.price / self.old_price) * 100)


@dataclass
class SearchQuery:
    """Поисковый запрос"""
    raw_query: str
    normalized_query: str = ""
    tokens: List[str] = field(default_factory=list)
    corrected: bool = False
    original_query: Optional[str] = None  # если была коррекция


@dataclass
class SearchResult:
    """Результат поиска"""
    query: str
    total: int
    items: List[Product]
    facets: Dict[str, Any] = field(default_factory=dict)
    took_ms: int = 0
    query_corrected: bool = False
    corrected_query: Optional[str] = None


@dataclass
class Suggestion:
    """Подсказка"""
    text: str
    count: int = 0
    highlight: str = ""
    type: str = "query"  # query, category, product


@dataclass
class SuggestResult:
    """Результат подсказок"""
    prefix: str
    queries: List[Suggestion] = field(default_factory=list)
    categories: List[Dict] = field(default_factory=list)
    products: List[Product] = field(default_factory=list)
    took_ms: int = 0


@dataclass
class Synonym:
    """Синоним"""
    id: str
    project_id: str
    word: str
    synonyms: List[str]


@dataclass
class SearchStats:
    """Статистика поискового запроса"""
    id: str
    project_id: str
    query: str
    results_count: int
    clicked_product_id: Optional[str] = None
    click_position: Optional[int] = None
    session_id: Optional[str] = None
    created_at: datetime = field(default_factory=datetime.now)


@dataclass
class FeedLog:
    """Лог обработки фида"""
    id: str
    feed_id: str
    status: FeedStatus
    items_processed: int = 0
    items_added: int = 0
    items_updated: int = 0
    items_deleted: int = 0
    errors_count: int = 0
    duration_ms: int = 0
    error_message: Optional[str] = None
    created_at: datetime = field(default_factory=datetime.now)
