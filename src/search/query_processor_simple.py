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

# Маппинг раскладки EN -> RU (клавиши)
EN_TO_RU = {
    'q': 'й', 'w': 'ц', 'e': 'у', 'r': 'к', 't': 'е', 'y': 'н', 'u': 'г',
    'i': 'ш', 'o': 'щ', 'p': 'з', '[': 'х', ']': 'ъ', 'a': 'ф', 's': 'ы',
    'd': 'в', 'f': 'а', 'g': 'п', 'h': 'р', 'j': 'о', 'k': 'л', 'l': 'д',
    ';': 'ж', "'": 'э', 'z': 'я', 'x': 'ч', 'c': 'с', 'v': 'м', 'b': 'и',
    'n': 'т', 'm': 'ь', ',': 'б', '.': 'ю', '/': '.',
}

# Маппинг раскладки RU -> EN
RU_TO_EN = {v: k for k, v in EN_TO_RU.items()}


def convert_layout(text: str, to_russian: bool = True) -> str:
    """Конвертация раскладки клавиатуры"""
    mapping = EN_TO_RU if to_russian else RU_TO_EN
    result = []
    for char in text.lower():
        result.append(mapping.get(char, char))
    return ''.join(result)


def detect_wrong_layout(text: str) -> bool:
    """Определяет, похоже ли что текст набран в неправильной раскладке"""
    # Если есть смесь русских и латинских букв - возможно неправильная раскладка
    has_russian = bool(re.search(r'[а-яё]', text.lower()))
    has_latin = bool(re.search(r'[a-z]', text.lower()))
    
    # Типичные признаки неправильной раскладки:
    # - только русские буквы но выглядит как артикул (5ц30 вместо 5w30)
    # - только латинские буквы но выглядит как русское слово
    return has_russian != has_latin  # True если только один тип букв


@dataclass
class SearchQuery:
    """Обработанный поисковый запрос"""
    raw_query: str
    normalized_query: str
    tokens: List[str]
    corrected: bool = False
    layout_variants: List[str] = None  # Варианты с другой раскладкой


class SimpleQueryProcessor:
    """
    Упрощенный обработчик запросов
    
    Выполняет:
    1. Нормализацию (lowercase, удаление спецсимволов)
    2. Токенизацию
    3. Удаление стоп-слов
    4. Конвертацию раскладки
    """
    
    def __init__(self, stopwords: Set[str] = None):
        self.stopwords = stopwords or DEFAULT_STOPWORDS_RU
    
    def process(self, query: str) -> SearchQuery:
        """Полная обработка запроса"""
        normalized = self.normalize(query)
        tokens = self.tokenize(normalized)
        
        # Генерируем варианты с другой раскладкой
        layout_variants = self._get_layout_variants(normalized)
        
        return SearchQuery(
            raw_query=query,
            normalized_query=normalized,
            tokens=tokens,
            corrected=False,
            layout_variants=layout_variants
        )
    
    def _get_layout_variants(self, text: str) -> List[str]:
        """Генерирует варианты запроса с другой раскладкой"""
        variants = []
        
        # Конвертируем в русскую раскладку
        ru_variant = convert_layout(text, to_russian=True)
        if ru_variant != text:
            variants.append(ru_variant)
        
        # Конвертируем в английскую раскладку
        en_variant = convert_layout(text, to_russian=False)
        if en_variant != text and en_variant != ru_variant:
            variants.append(en_variant)
        
        return variants
    
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
        # Сначала разбиваем по пробелам
        raw_tokens = query.split()
        
        tokens = []
        for t in raw_tokens:
            if not t or t in self.stopwords:
                continue
            
            # Добавляем оригинальный токен (с дефисом если есть)
            if len(t) > 1:
                tokens.append(t)
            
            # Если содержит дефис - добавляем также части и слитную версию
            if '-' in t:
                parts = t.split('-')
                # Слитная версия без дефиса
                joined = ''.join(parts)
                if len(joined) > 1 and joined not in tokens:
                    tokens.append(joined)
                # Отдельные части если значимые
                for part in parts:
                    if len(part) > 1 and part not in self.stopwords and part not in tokens:
                        tokens.append(part)
        
        return tokens
    
    def get_all_query_variants(self, query: str) -> List[str]:
        """Возвращает все варианты запроса (оригинал + раскладки)"""
        normalized = self.normalize(query)
        variants = [normalized]
        variants.extend(self._get_layout_variants(normalized))
        return variants


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
