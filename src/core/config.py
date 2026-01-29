"""
Конфигурация сервиса
"""
from dataclasses import dataclass, field
from typing import Optional
import os


@dataclass
class DatabaseConfig:
    """Настройки PostgreSQL"""
    host: str = "localhost"
    port: int = 5432
    database: str = "search_service"
    user: str = "postgres"
    password: str = ""
    pool_size: int = 10
    
    @property
    def url(self) -> str:
        return f"postgresql://{self.user}:{self.password}@{self.host}:{self.port}/{self.database}"


@dataclass
class RedisConfig:
    """Настройки Redis"""
    host: str = "localhost"
    port: int = 6379
    password: Optional[str] = None
    db: int = 0
    pool_size: int = 20
    
    # TTL для кэша (секунды)
    search_cache_ttl: int = 60
    suggest_cache_ttl: int = 30
    popular_cache_ttl: int = 300
    
    @property
    def url(self) -> str:
        auth = f":{self.password}@" if self.password else ""
        return f"redis://{auth}{self.host}:{self.port}/{self.db}"


@dataclass
class SearchConfig:
    """Настройки поиска"""
    # Минимальная длина запроса
    min_query_length: int = 2
    
    # Результаты
    default_limit: int = 20
    max_limit: int = 100
    
    # Подсказки
    suggestions_limit: int = 10
    suggestion_products_limit: int = 4
    
    # N-gram настройки
    ngram_min: int = 3
    ngram_max: int = 3
    
    # Исправление опечаток
    typo_max_distance: int = 2
    typo_min_word_length: int = 4
    
    # Ранжирование
    text_match_weight: float = 0.4
    stock_weight: float = 0.2
    popularity_weight: float = 0.2
    commercial_weight: float = 0.2
    
    # Буст для товаров в наличии
    in_stock_boost: float = 1.0
    out_of_stock_penalty: float = 0.3


@dataclass
class FeedConfig:
    """Настройки обработки фидов"""
    # Таймауты
    download_timeout: int = 300  # секунды
    
    # Лимиты
    max_feed_size: int = 500 * 1024 * 1024  # 500 MB
    max_products: int = 1_000_000
    
    # Интервалы обновления по умолчанию
    full_feed_interval: int = 3600  # 1 час
    delta_feed_interval: int = 300  # 5 минут
    
    # Retry политика
    retry_count: int = 3
    retry_delay: int = 60  # секунды


@dataclass
class ApiConfig:
    """Настройки API"""
    host: str = "0.0.0.0"
    port: int = 8000
    
    # Rate limiting
    rate_limit_per_minute: int = 600
    rate_limit_per_day: int = 100_000
    
    # CORS
    cors_origins: list = field(default_factory=lambda: ["*"])
    
    # API ключи
    api_key_length: int = 32
    api_key_prefix: str = "sk_live_"


@dataclass
class Config:
    """Главная конфигурация"""
    env: str = "development"
    debug: bool = True
    
    database: DatabaseConfig = field(default_factory=DatabaseConfig)
    redis: RedisConfig = field(default_factory=RedisConfig)
    search: SearchConfig = field(default_factory=SearchConfig)
    feed: FeedConfig = field(default_factory=FeedConfig)
    api: ApiConfig = field(default_factory=ApiConfig)
    
    @classmethod
    def from_env(cls) -> "Config":
        """Загрузить конфигурацию из переменных окружения"""
        return cls(
            env=os.getenv("ENV", "development"),
            debug=os.getenv("DEBUG", "true").lower() == "true",
            
            database=DatabaseConfig(
                host=os.getenv("DB_HOST", "localhost"),
                port=int(os.getenv("DB_PORT", "5432")),
                database=os.getenv("DB_NAME", "search_service"),
                user=os.getenv("DB_USER", "postgres"),
                password=os.getenv("DB_PASSWORD", ""),
            ),
            
            redis=RedisConfig(
                host=os.getenv("REDIS_HOST", "localhost"),
                port=int(os.getenv("REDIS_PORT", "6379")),
                password=os.getenv("REDIS_PASSWORD"),
            ),
            
            api=ApiConfig(
                host=os.getenv("API_HOST", "0.0.0.0"),
                port=int(os.getenv("API_PORT", "8000")),
            ),
        )


# Глобальный экземпляр конфигурации
config = Config.from_env()
