"""
Обработчик поисковых запросов
"""
import re
from typing import List, Dict, Set, Tuple, Optional
from dataclasses import dataclass

from ..core.models import SearchQuery
from ..core.interfaces import IQueryProcessor


# Русские стоп-слова по умолчанию
DEFAULT_STOPWORDS_RU = {
    "и", "в", "во", "не", "что", "он", "на", "я", "с", "со", "как", "а", "то",
    "все", "она", "так", "его", "но", "да", "ты", "к", "у", "же", "вы", "за",
    "бы", "по", "только", "её", "ее", "мне", "было", "вот", "от", "меня", "ещё",
    "нет", "о", "из", "ему", "теперь", "когда", "уже", "вам", "ни", "быть", "был",
    "него", "до", "вас", "нибудь", "опять", "уж", "вам", "ведь", "там", "потом",
    "себя", "ничего", "ей", "может", "они", "тут", "где", "есть", "надо", "ней",
    "для", "мы", "тебя", "их", "чем", "была", "сам", "чтоб", "без", "будто",
    "чего", "раз", "тоже", "себе", "под", "будет", "ж", "тогда", "кто", "этот",
    "того", "потому", "этого", "какой", "совсем", "ним", "здесь", "этом", "один",
    "почти", "мой", "тем", "чтобы", "нее", "сейчас", "были", "куда", "зачем",
    "всех", "можно", "при", "над", "чуть", "том", "такой", "им", "более", "всего",
}


class QueryProcessor(IQueryProcessor):
    """
    Обработчик поисковых запросов
    
    Выполняет:
    1. Нормализацию (lowercase, удаление спецсимволов)
    2. Токенизацию
    3. Удаление стоп-слов
    4. Исправление опечаток
    5. Расширение синонимами
    """
    
    def __init__(
        self,
        stopwords: Set[str] = None,
        synonyms_getter=None,  # Функция для получения синонимов
        dictionary_getter=None,  # Функция для получения словаря (для опечаток)
    ):
        self.stopwords = stopwords or DEFAULT_STOPWORDS_RU
        self.synonyms_getter = synonyms_getter
        self.dictionary_getter = dictionary_getter
    
    def process(self, query: str, project_id: str) -> SearchQuery:
        """
        Полная обработка поискового запроса
        """
        # 1. Нормализация
        normalized = self.normalize(query)
        
        # 2. Токенизация
        tokens = self.tokenize(normalized)
        
        # 3. Исправление опечаток
        corrected = False
        original_tokens = tokens.copy()
        
        if self.dictionary_getter:
            tokens = self.fix_typos(tokens, project_id)
            corrected = tokens != original_tokens
        
        # 4. Расширение синонимами (опционально, для повышения recall)
        # Синонимы добавляются как OR варианты при поиске
        
        return SearchQuery(
            raw_query=query,
            normalized_query=normalized,
            tokens=tokens,
            corrected=corrected,
            original_query=query if corrected else None
        )
    
    def normalize(self, query: str) -> str:
        """
        Нормализация запроса
        
        1. Приведение к нижнему регистру
        2. Удаление лишних пробелов
        3. Удаление специальных символов (кроме дефиса и цифр)
        """
        # Lowercase
        query = query.lower()
        
        # Заменяем ё на е
        query = query.replace('ё', 'е')
        
        # Удаляем специальные символы, оставляем буквы, цифры, пробелы, дефисы
        query = re.sub(r'[^\w\s\-]', ' ', query)
        
        # Удаляем множественные пробелы
        query = ' '.join(query.split())
        
        return query.strip()
    
    def tokenize(self, query: str) -> List[str]:
        """
        Разбиение на токены с удалением стоп-слов
        """
        # Разбиваем по пробелам и дефисам
        raw_tokens = re.split(r'[\s\-]+', query)
        
        # Фильтруем пустые и стоп-слова
        tokens = [
            t for t in raw_tokens 
            if t and t not in self.stopwords and len(t) > 1
        ]
        
        return tokens
    
    def fix_typos(self, tokens: List[str], project_id: str) -> List[str]:
        """
        Исправление опечаток с помощью расстояния Левенштейна
        """
        if not self.dictionary_getter:
            return tokens
        
        dictionary = self.dictionary_getter(project_id)
        if not dictionary:
            return tokens
        
        fixed = []
        for token in tokens:
            # Короткие слова не исправляем
            if len(token) < 4:
                fixed.append(token)
                continue
            
            # Если слово есть в словаре - оставляем
            if token in dictionary:
                fixed.append(token)
                continue
            
            # Ищем ближайшее слово
            best_match = self._find_closest_word(token, dictionary)
            fixed.append(best_match if best_match else token)
        
        return fixed
    
    def _find_closest_word(
        self, 
        word: str, 
        dictionary: Set[str], 
        max_distance: int = 2
    ) -> Optional[str]:
        """
        Найти ближайшее слово в словаре
        """
        candidates = []
        
        for dict_word in dictionary:
            # Оптимизация: пропускаем слова с большой разницей в длине
            if abs(len(dict_word) - len(word)) > max_distance:
                continue
            
            distance = self._levenshtein_distance(word, dict_word)
            if distance <= max_distance:
                candidates.append((dict_word, distance))
        
        if not candidates:
            return None
        
        # Возвращаем слово с минимальным расстоянием
        candidates.sort(key=lambda x: x[1])
        return candidates[0][0]
    
    def _levenshtein_distance(self, s1: str, s2: str) -> int:
        """
        Расстояние Левенштейна между двумя строками
        """
        if len(s1) < len(s2):
            s1, s2 = s2, s1
        
        if len(s2) == 0:
            return len(s1)
        
        previous_row = range(len(s2) + 1)
        
        for i, c1 in enumerate(s1):
            current_row = [i + 1]
            for j, c2 in enumerate(s2):
                insertions = previous_row[j + 1] + 1
                deletions = current_row[j] + 1
                substitutions = previous_row[j] + (c1 != c2)
                current_row.append(min(insertions, deletions, substitutions))
            previous_row = current_row
        
        return previous_row[-1]
    
    def expand_synonyms(self, tokens: List[str], project_id: str) -> List[List[str]]:
        """
        Расширение токенов синонимами
        
        Возвращает список списков, где каждый внутренний список
        содержит токен и его синонимы
        """
        if not self.synonyms_getter:
            return [[t] for t in tokens]
        
        synonyms_dict = self.synonyms_getter(project_id)
        if not synonyms_dict:
            return [[t] for t in tokens]
        
        expanded = []
        for token in tokens:
            if token in synonyms_dict:
                # Токен + все его синонимы
                expanded.append([token] + synonyms_dict[token])
            else:
                expanded.append([token])
        
        return expanded


class NGramGenerator:
    """
    Генератор n-грамм для частичного поиска
    """
    
    def __init__(self, n: int = 3):
        self.n = n
    
    def generate(self, word: str) -> List[str]:
        """
        Генерация n-грамм для слова
        
        Пример для n=3:
        "кроссовки" -> ["__к", "_кр", "кро", "рос", "осс", "ссо", "сов", "овк", "вки", "ки_", "и__"]
        """
        # Добавляем маркеры начала и конца
        padded = f"{'_' * (self.n - 1)}{word}{'_' * (self.n - 1)}"
        return [padded[i:i + self.n] for i in range(len(padded) - self.n + 1)]
    
    def generate_for_prefix(self, prefix: str) -> List[str]:
        """
        Генерация n-грамм для префикса (для поиска по началу слова)
        """
        padded = f"{'_' * (self.n - 1)}{prefix}"
        return [padded[i:i + self.n] for i in range(len(padded) - self.n + 1)]


class Stemmer:
    """
    Простой стеммер для русского языка
    (удаление окончаний)
    """
    
    # Окончания для удаления (отсортированы по длине, от большего к меньшему)
    ENDINGS = [
        # Существительные
        "ами", "ями", "ого", "его", "ому", "ему", "ой", "ей", "ию",
        "ии", "ия", "ие", "ье", "ья", "ов", "ев", "ей",
        # Прилагательные
        "ими", "ыми", "ого", "его", "ому", "ему", "ую", "юю",
        "ая", "яя", "ое", "ее", "ий", "ый", "ой",
        # Глаголы
        "ешь", "ете", "ить", "ать", "ять", "уть",
        "ет", "ит", "ут", "ют", "ал", "ил", "ел",
        # Общие
        "ах", "ях", "ом", "ем", "ам", "ям", "ых", "их",
        "ы", "и", "а", "я", "у", "ю", "о", "е", "ь",
    ]
    
    def stem(self, word: str) -> str:
        """
        Получить основу слова (стем)
        """
        if len(word) <= 3:
            return word
        
        for ending in self.ENDINGS:
            if word.endswith(ending) and len(word) - len(ending) >= 2:
                return word[:-len(ending)]
        
        return word
    
    def stem_tokens(self, tokens: List[str]) -> List[str]:
        """
        Применить стемминг к списку токенов
        """
        return [self.stem(t) for t in tokens]
