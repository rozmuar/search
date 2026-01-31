"""
Упрощенный обработчик запросов без ML
Базовая токенизация и нормализация
"""
import re
from typing import List, Set
from dataclasses import dataclass


# Русские стоп-слова
DEFAULT_STOPWORDS_RU = {
    "и", "в", "во", "не", "что", "он", "на", "я", "с", "со", "как", "а", "то",
    "все", "она", "так", "его", "но", "да", "ты", "к", "у", "же", "вы", "за",
    "бы", "по", "только", "её", "ее", "мне", "было", "вот", "от", "меня", "ещё",
    "нет", "о", "из", "ему", "теперь", "когда", "уже", "вам", "ни", "быть", "был",
    "для", "мы", "их", "без", "том", "более", "всего",
}


@dataclass
class SearchQuery:
    """Обработанный поисковый запрос"""
    raw_query: str
    normalized_query: str
    tokens: List[str]
    corrected: bool = False


class SimpleQueryProcessor:
    """
    Упрощенный обработчик запросов
    
    Выполняет:
    1. Нормализацию (lowercase, удаление спецсимволов)
    2. Токенизацию
    3. Удаление стоп-слов
    """
    
    def __init__(self, stopwords: Set[str] = None):
        self.stopwords = stopwords or DEFAULT_STOPWORDS_RU
    
    def process(self, query: str) -> SearchQuery:
        """Полная обработка запроса"""
        normalized = self.normalize(query)
        tokens = self.tokenize(normalized)
        
        return SearchQuery(
            raw_query=query,
            normalized_query=normalized,
            tokens=tokens,
            corrected=False
        )
    
    def normalize(self, query: str) -> str:
        """
        Нормализация запроса
        - lowercase
        - удаление спецсимволов
        - удаление лишних пробелов
        """
        query = query.lower()
        query = query.replace('ё', 'е')
        
        # Оставляем буквы, цифры, пробелы, дефисы
        query = re.sub(r'[^\w\s\-]', ' ', query)
        query = ' '.join(query.split())
        
        return query.strip()
    
    def tokenize(self, query: str) -> List[str]:
        """Разбиение на токены с удалением стоп-слов"""
        raw_tokens = re.split(r'[\s\-]+', query)
        
        tokens = [
            t for t in raw_tokens 
            if t and t not in self.stopwords and len(t) > 1
        ]
        
        return tokens


class NGramGenerator:
    """Генератор n-gram для частичного совпадения"""
    
    def __init__(self, n: int = 3):
        self.n = n
    
    def generate(self, text: str) -> List[str]:
        """Генерация n-gram из текста"""
        if len(text) < self.n:
            return [text]
        
        ngrams = []
        for i in range(len(text) - self.n + 1):
            ngrams.append(text[i:i + self.n])
        
        return ngrams
