"""
Core модуль - модели, интерфейсы, конфигурация
"""
from .models import (
    User,
    Project,
    Feed,
    Product,
    SearchQuery,
    SearchResult,
    Suggestion,
    SuggestResult,
    Synonym,
    SearchStats,
    FeedLog,
    FeedType,
    FeedFormat,
    FeedStatus,
    ProjectStatus,
)

from .interfaces import (
    ISearchEngine,
    IQueryProcessor,
    IIndexer,
    IFeedProcessor,
    ICache,
    IAnalytics,
    IProjectRepository,
    IFeedRepository,
    ISynonymRepository,
)

from .config import Config, config

__all__ = [
    # Models
    "User",
    "Project",
    "Feed",
    "Product",
    "SearchQuery",
    "SearchResult",
    "Suggestion",
    "SuggestResult",
    "Synonym",
    "SearchStats",
    "FeedLog",
    "FeedType",
    "FeedFormat",
    "FeedStatus",
    "ProjectStatus",
    
    # Interfaces
    "ISearchEngine",
    "IQueryProcessor",
    "IIndexer",
    "IFeedProcessor",
    "ICache",
    "IAnalytics",
    "IProjectRepository",
    "IFeedRepository",
    "ISynonymRepository",
    
    # Config
    "Config",
    "config",
]
