"""
Spell Checker - исправление опечаток в поисковых запросах

Методы:
1. SymSpell - быстрый алгоритм на основе словаря
2. Edit distance - расстояние Левенштейна
3. Neural - нейросетевой подход (T5, BERT)
"""
import re
from typing import List, Dict, Set, Optional, Tuple
from dataclasses import dataclass
from collections import defaultdict
import hashlib


@dataclass
class SpellCheckResult:
    """Результат проверки орфографии"""
    original: str
    corrected: str
    corrections: List[Tuple[str, str]]  # [(original_word, corrected_word), ...]
    confidence: float
    was_corrected: bool


class SpellChecker:
    """
    Проверка и исправление опечаток
    
    Использует комбинацию методов:
    1. Словарь известных слов (из индекса товаров)
    2. SymSpell для быстрого поиска кандидатов
    3. Контекстное ранжирование
    """
    
    def __init__(
        self,
        max_edit_distance: int = 2,
        min_word_length: int = 3,
        dictionary: Optional[Set[str]] = None
    ):
        self.max_edit_distance = max_edit_distance
        self.min_word_length = min_word_length
        self.dictionary = dictionary or set()
        self.word_frequencies = defaultdict(int)
        
        # SymSpell индекс (слово с удалёнными символами -> оригиналы)
        self._symspell_index: Dict[str, Set[str]] = defaultdict(set)
        
        # Кэш исправлений
        self._cache: Dict[str, str] = {}
    
    def build_dictionary(self, texts: List[str]):
        """
        Построение словаря из текстов товаров
        
        Args:
            texts: Список текстов (названия, описания товаров)
        """
        for text in texts:
            words = self._tokenize(text)
            for word in words:
                if len(word) >= self.min_word_length:
                    self.dictionary.add(word)
                    self.word_frequencies[word] += 1
        
        # Строим SymSpell индекс
        self._build_symspell_index()
    
    def add_words(self, words: List[str]):
        """Добавление слов в словарь"""
        for word in words:
            word = word.lower()
            if len(word) >= self.min_word_length:
                self.dictionary.add(word)
                self.word_frequencies[word] += 1
                self._add_to_symspell(word)
    
    def check(self, query: str) -> SpellCheckResult:
        """
        Проверка и исправление запроса
        
        Args:
            query: Поисковый запрос
            
        Returns:
            SpellCheckResult с исправленным запросом
        """
        # Проверяем кэш
        cache_key = query.lower()
        if cache_key in self._cache:
            corrected = self._cache[cache_key]
            return SpellCheckResult(
                original=query,
                corrected=corrected,
                corrections=[],
                confidence=1.0,
                was_corrected=(query.lower() != corrected)
            )
        
        words = self._tokenize(query)
        corrections = []
        corrected_words = []
        total_confidence = 0.0
        
        for word in words:
            if len(word) < self.min_word_length or word in self.dictionary:
                # Слово в словаре или слишком короткое
                corrected_words.append(word)
                total_confidence += 1.0
            else:
                # Ищем исправление
                correction, confidence = self._find_correction(word)
                corrected_words.append(correction)
                total_confidence += confidence
                
                if correction != word:
                    corrections.append((word, correction))
        
        corrected = " ".join(corrected_words)
        avg_confidence = total_confidence / len(words) if words else 1.0
        
        # Сохраняем в кэш
        self._cache[cache_key] = corrected
        
        return SpellCheckResult(
            original=query,
            corrected=corrected,
            corrections=corrections,
            confidence=avg_confidence,
            was_corrected=len(corrections) > 0
        )
    
    def _tokenize(self, text: str) -> List[str]:
        """Токенизация текста"""
        text = text.lower()
        # Удаляем всё кроме букв, цифр, пробелов
        text = re.sub(r'[^\w\s]', ' ', text)
        return text.split()
    
    def _build_symspell_index(self):
        """
        Построение SymSpell индекса
        
        Для каждого слова генерируем варианты с удалёнными символами
        и сохраняем маппинг delete -> originals
        """
        self._symspell_index.clear()
        
        for word in self.dictionary:
            self._add_to_symspell(word)
    
    def _add_to_symspell(self, word: str):
        """Добавление слова в SymSpell индекс"""
        # Само слово
        self._symspell_index[word].add(word)
        
        # Генерируем deletes
        deletes = self._generate_deletes(word, self.max_edit_distance)
        for delete in deletes:
            self._symspell_index[delete].add(word)
    
    def _generate_deletes(self, word: str, max_distance: int) -> Set[str]:
        """
        Генерация всех вариантов слова с удалёнными символами
        """
        deletes = set()
        
        def _recurse(word: str, distance: int):
            if distance == 0:
                return
            for i in range(len(word)):
                delete = word[:i] + word[i+1:]
                if delete and delete not in deletes:
                    deletes.add(delete)
                    _recurse(delete, distance - 1)
        
        _recurse(word, max_distance)
        return deletes
    
    def _find_correction(self, word: str) -> Tuple[str, float]:
        """
        Поиск исправления для слова
        
        Returns:
            (corrected_word, confidence)
        """
        candidates = self._get_candidates(word)
        
        if not candidates:
            return word, 0.5  # Низкая уверенность, оставляем как есть
        
        # Ранжируем кандидатов
        scored = []
        for candidate in candidates:
            distance = self._levenshtein_distance(word, candidate)
            frequency = self.word_frequencies.get(candidate, 1)
            
            # Score: меньше расстояние + больше частота = лучше
            score = frequency / (distance + 1)
            scored.append((candidate, distance, score))
        
        # Сортируем по score desc
        scored.sort(key=lambda x: x[2], reverse=True)
        
        best_candidate, distance, _ = scored[0]
        
        # Confidence зависит от расстояния
        confidence = 1.0 - (distance / (self.max_edit_distance + 1))
        
        return best_candidate, confidence
    
    def _get_candidates(self, word: str) -> Set[str]:
        """
        Получение кандидатов для исправления через SymSpell
        """
        candidates = set()
        
        # Проверяем само слово
        if word in self._symspell_index:
            candidates.update(self._symspell_index[word])
        
        # Проверяем deletes от входного слова
        deletes = self._generate_deletes(word, self.max_edit_distance)
        for delete in deletes:
            if delete in self._symspell_index:
                candidates.update(self._symspell_index[delete])
        
        # Фильтруем по расстоянию
        valid_candidates = set()
        for candidate in candidates:
            distance = self._levenshtein_distance(word, candidate)
            if distance <= self.max_edit_distance:
                valid_candidates.add(candidate)
        
        return valid_candidates
    
    def _levenshtein_distance(self, s1: str, s2: str) -> int:
        """Расстояние Левенштейна"""
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


class TransliterationChecker:
    """
    Проверка и исправление транслитерации
    
    Примеры:
    - "ajfon" -> "айфон"
    - "samsung" -> "самсунг" (опционально)
    - "найке" -> "nike"
    """
    
    # Таблица транслитерации (латиница -> кириллица)
    TRANSLIT_MAP = {
        'a': 'а', 'b': 'б', 'v': 'в', 'g': 'г', 'd': 'д',
        'e': 'е', 'yo': 'ё', 'zh': 'ж', 'z': 'з', 'i': 'и',
        'j': 'й', 'k': 'к', 'l': 'л', 'm': 'м', 'n': 'н',
        'o': 'о', 'p': 'п', 'r': 'р', 's': 'с', 't': 'т',
        'u': 'у', 'f': 'ф', 'h': 'х', 'ts': 'ц', 'ch': 'ч',
        'sh': 'ш', 'sch': 'щ', 'y': 'ы', 'e': 'э', 'yu': 'ю',
        'ya': 'я', 'x': 'кс', 'w': 'в', 'q': 'к',
    }
    
    # Обратная таблица
    REVERSE_MAP = {v: k for k, v in TRANSLIT_MAP.items()}
    
    def __init__(self, known_brands: Optional[Set[str]] = None):
        self.known_brands = known_brands or {
            'nike', 'adidas', 'puma', 'reebok', 'samsung', 'apple',
            'iphone', 'huawei', 'xiaomi', 'sony', 'lg', 'bosch',
        }
    
    def transliterate_to_cyrillic(self, text: str) -> str:
        """Транслитерация латиницы в кириллицу"""
        result = text.lower()
        
        # Сначала заменяем двухбуквенные комбинации
        for lat, cyr in sorted(self.TRANSLIT_MAP.items(), key=lambda x: -len(x[0])):
            result = result.replace(lat, cyr)
        
        return result
    
    def transliterate_to_latin(self, text: str) -> str:
        """Транслитерация кириллицы в латиницу"""
        result = text.lower()
        
        for cyr, lat in self.REVERSE_MAP.items():
            result = result.replace(cyr, lat)
        
        return result
    
    def get_variants(self, word: str) -> List[str]:
        """
        Получение вариантов написания слова
        
        Returns:
            Список вариантов [original, translit_cyrillic, translit_latin]
        """
        variants = [word]
        
        # Если слово на латинице
        if re.match(r'^[a-zA-Z]+$', word):
            cyrillic = self.transliterate_to_cyrillic(word)
            if cyrillic != word:
                variants.append(cyrillic)
        
        # Если слово на кириллице
        elif re.match(r'^[а-яёА-ЯЁ]+$', word):
            latin = self.transliterate_to_latin(word)
            if latin != word:
                variants.append(latin)
        
        return variants
    
    def is_known_brand(self, word: str) -> bool:
        """Проверка, является ли слово известным брендом"""
        return word.lower() in self.known_brands
