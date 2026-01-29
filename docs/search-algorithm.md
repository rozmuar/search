# Алгоритм поиска

## Обзор

Поисковый алгоритм состоит из нескольких этапов:

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Запрос    │───▶│ Обработка   │───▶│   Поиск     │───▶│ Ранжиро-    │
│             │    │   запроса   │    │             │    │   вание     │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
                                                               │
                                                               ▼
                                                         ┌─────────────┐
                                                         │  Результат  │
                                                         └─────────────┘
```

## 1. Обработка запроса (Query Processing)

### 1.1 Нормализация

```python
def normalize_query(query: str) -> str:
    """
    Приведение запроса к нормальной форме
    """
    # 1. Приведение к нижнему регистру
    query = query.lower()
    
    # 2. Удаление лишних пробелов
    query = ' '.join(query.split())
    
    # 3. Удаление специальных символов (кроме дефиса)
    query = re.sub(r'[^\w\s\-]', '', query)
    
    # 4. Транслитерация (опционально)
    # "айфон" -> также искать "iphone"
    query_translit = transliterate(query)
    
    return query, query_translit
```

### 1.2 Токенизация

```python
def tokenize(query: str) -> List[str]:
    """
    Разбиение запроса на токены
    """
    # Разбиваем по пробелам
    tokens = query.split()
    
    # Удаляем стоп-слова
    tokens = [t for t in tokens if t not in STOPWORDS]
    
    # Стемминг/лемматизация для русского языка
    tokens = [stem(t) for t in tokens]
    
    return tokens

# Пример:
# "красные кроссовки nike" -> ["красн", "кроссовк", "nike"]
```

### 1.3 Исправление опечаток

```python
def fix_typos(tokens: List[str], dictionary: Set[str]) -> List[str]:
    """
    Исправление опечаток с помощью расстояния Левенштейна
    """
    fixed = []
    for token in tokens:
        if token in dictionary:
            fixed.append(token)
        else:
            # Ищем ближайшее слово в словаре
            candidates = []
            for word in dictionary:
                distance = levenshtein(token, word)
                if distance <= 2:  # максимум 2 ошибки
                    candidates.append((word, distance))
            
            if candidates:
                # Берём слово с минимальным расстоянием
                best = min(candidates, key=lambda x: x[1])
                fixed.append(best[0])
            else:
                fixed.append(token)
    
    return fixed

# Пример:
# "красныйе кросовки" -> "красные кроссовки"
```

### 1.4 Расширение синонимами

```python
def expand_synonyms(tokens: List[str], synonyms: Dict) -> List[List[str]]:
    """
    Расширение запроса синонимами
    """
    expanded = []
    for token in tokens:
        if token in synonyms:
            # Добавляем токен + все его синонимы
            expanded.append([token] + synonyms[token])
        else:
            expanded.append([token])
    
    return expanded

# Пример:
# synonyms = {"телефон": ["смартфон", "мобильный"]}
# "телефон samsung" -> [["телефон", "смартфон", "мобильный"], ["samsung"]]
```

## 2. Поиск (Search)

### 2.1 Инвертированный индекс

Основная структура для полнотекстового поиска:

```
Структура индекса:
─────────────────
"кроссовки" -> {product_1: 0.95, product_5: 0.87, product_12: 0.82}
"nike"      -> {product_1: 0.90, product_3: 0.85}
"красный"   -> {product_1: 0.80, product_7: 0.75}

Поиск "красные кроссовки nike":
───────────────────────────────
1. Получаем множества для каждого токена
2. Находим пересечение (AND) или объединение (OR)
3. Суммируем/усредняем скоры
```

```python
def search_inverted_index(tokens: List[str], index: Dict) -> Dict[str, float]:
    """
    Поиск по инвертированному индексу
    """
    results = {}
    
    for token in tokens:
        if token in index:
            for product_id, score in index[token].items():
                if product_id in results:
                    results[product_id] += score
                else:
                    results[product_id] = score
    
    return results
```

### 2.2 N-gram индекс для частичного совпадения

Для поиска по части слова используем n-граммы:

```
Слово "кроссовки" разбивается на триграммы:
─────────────────────────────────────────
"кро", "рос", "осс", "ссо", "сов", "овк", "вки"

При поиске "кросс" находим триграммы:
"кро", "рос", "осс", "ссо"

Ищем пересечение с индексом -> находим "кроссовки"
```

```python
def generate_ngrams(word: str, n: int = 3) -> List[str]:
    """
    Генерация n-грамм для слова
    """
    # Добавляем маркеры начала и конца
    word = f"__{word}__"
    return [word[i:i+n] for i in range(len(word) - n + 1)]

def search_ngram_index(partial: str, ngram_index: Dict) -> List[str]:
    """
    Поиск слов по частичному совпадению
    """
    ngrams = generate_ngrams(partial)
    
    # Подсчитываем количество совпадений для каждого слова
    word_scores = {}
    for ngram in ngrams:
        if ngram in ngram_index:
            for word in ngram_index[ngram]:
                word_scores[word] = word_scores.get(word, 0) + 1
    
    # Нормализуем по количеству n-грамм
    for word in word_scores:
        word_ngrams = len(generate_ngrams(word))
        word_scores[word] /= word_ngrams
    
    # Сортируем по релевантности
    return sorted(word_scores.items(), key=lambda x: -x[1])
```

### 2.3 Prefix-дерево для подсказок

Для мгновенных подсказок используем Trie:

```
                    root
                   /    \
                  к      n
                 /        \
                р          i
               /            \
              о              k
             /                \
            с     "крос..."    e    "nike"
           /
          с
         /
        о
       /
      в
     /
    к
   /
  и     "кроссовки"
```

```python
class TrieNode:
    def __init__(self):
        self.children = {}
        self.is_end = False
        self.products = []  # товары для этого префикса
        self.popularity = 0  # популярность запроса

class SuggestionTrie:
    def __init__(self):
        self.root = TrieNode()
    
    def insert(self, word: str, product_ids: List[str], popularity: int = 0):
        node = self.root
        for char in word:
            if char not in node.children:
                node.children[char] = TrieNode()
            node = node.children[char]
        node.is_end = True
        node.products = product_ids
        node.popularity = popularity
    
    def search_prefix(self, prefix: str, limit: int = 10) -> List[Suggestion]:
        """
        Поиск всех слов с данным префиксом
        """
        node = self.root
        for char in prefix:
            if char not in node.children:
                return []
            node = node.children[char]
        
        # DFS для сбора всех слов
        suggestions = []
        self._collect_words(node, prefix, suggestions)
        
        # Сортируем по популярности
        suggestions.sort(key=lambda x: -x.popularity)
        return suggestions[:limit]
```

## 3. Ранжирование (Ranking)

### 3.1 Факторы ранжирования

```python
@dataclass
class RankingFactors:
    # Релевантность текста
    text_match_score: float      # Совпадение с запросом
    position_score: float        # Позиция совпадения (начало важнее)
    exact_match_bonus: float     # Бонус за точное совпадение
    
    # Коммерческие факторы
    in_stock: bool               # Наличие на складе
    price_score: float           # Нормализованная цена
    discount_score: float        # Размер скидки
    
    # Популярность
    sales_count: int             # Количество продаж
    views_count: int             # Количество просмотров
    click_rate: float            # CTR в поиске
    
    # Дополнительные
    freshness: float             # Новизна товара
    image_quality: float         # Наличие качественных фото
```

### 3.2 Формула ранжирования

```python
def calculate_score(product: Product, query: str, factors: RankingFactors) -> float:
    """
    Расчёт итогового скора товара
    """
    
    # Веса факторов (настраиваемые)
    W_TEXT = 0.4
    W_STOCK = 0.2
    W_POPULARITY = 0.2
    W_COMMERCIAL = 0.2
    
    # 1. Текстовая релевантность
    text_score = (
        factors.text_match_score * 0.5 +
        factors.position_score * 0.3 +
        factors.exact_match_bonus * 0.2
    )
    
    # 2. Наличие (бинарный буст)
    stock_score = 1.0 if factors.in_stock else 0.3
    
    # 3. Популярность
    popularity_score = normalize(
        factors.sales_count * 0.4 +
        factors.views_count * 0.3 +
        factors.click_rate * 0.3
    )
    
    # 4. Коммерческие факторы
    commercial_score = (
        factors.discount_score * 0.6 +
        (1 - factors.price_score) * 0.4  # дешевле = лучше
    )
    
    # Итоговый скор
    final_score = (
        text_score * W_TEXT +
        stock_score * W_STOCK +
        popularity_score * W_POPULARITY +
        commercial_score * W_COMMERCIAL
    )
    
    return final_score
```

### 3.3 Текстовая релевантность (BM25)

```python
def bm25_score(query_tokens: List[str], document: str, 
               avg_doc_length: float, doc_count: int,
               k1: float = 1.5, b: float = 0.75) -> float:
    """
    BM25 - алгоритм ранжирования текстовой релевантности
    """
    doc_tokens = tokenize(document)
    doc_length = len(doc_tokens)
    score = 0.0
    
    for token in query_tokens:
        # Частота токена в документе
        tf = doc_tokens.count(token)
        
        # Количество документов с токеном
        df = get_document_frequency(token)
        
        # IDF - обратная документная частота
        idf = math.log((doc_count - df + 0.5) / (df + 0.5))
        
        # BM25 формула
        numerator = tf * (k1 + 1)
        denominator = tf + k1 * (1 - b + b * doc_length / avg_doc_length)
        
        score += idf * (numerator / denominator)
    
    return score
```

## 4. Подсказки (Suggestions)

### 4.1 Типы подсказок

```
┌─────────────────────────────────────────────────────────────┐
│  Поле ввода: "красн"                                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  📝 Поисковые подсказки:                                    │
│     • красные кроссовки                                     │
│     • красная куртка                                        │
│     • красное платье                                        │
│                                                              │
│  🏷️ Категории:                                              │
│     • Красная обувь (234)                                   │
│     • Красная одежда (567)                                  │
│                                                              │
│  📦 Товары:                                                  │
│     • [img] Кроссовки Nike Air Red     2 990 ₽             │
│     • [img] Куртка красная зимняя      5 490 ₽             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Алгоритм подсказок

```python
def get_suggestions(prefix: str, project_id: str, limit: int = 10) -> Suggestions:
    """
    Получение подсказок для префикса
    """
    
    # 1. Поиск в Trie по префиксу
    query_suggestions = trie.search_prefix(prefix, limit=5)
    
    # 2. Поиск категорий
    category_suggestions = search_categories(prefix, limit=3)
    
    # 3. Поиск товаров (быстрый, по n-gram индексу)
    products = search_products_fast(prefix, limit=4)
    
    # 4. Учёт истории пользователя (если есть)
    personalized = personalize_suggestions(
        query_suggestions, 
        user_history
    )
    
    return Suggestions(
        queries=personalized,
        categories=category_suggestions,
        products=products
    )
```

### 4.3 Персонализация подсказок

```python
def personalize_suggestions(suggestions: List[str], 
                           user_history: UserHistory) -> List[str]:
    """
    Персонализация на основе истории пользователя
    """
    
    # Категории, которые пользователь смотрел
    preferred_categories = user_history.viewed_categories
    
    # Буст подсказок из предпочитаемых категорий
    scored = []
    for suggestion in suggestions:
        score = suggestion.base_score
        
        # Буст за совпадение с историей
        if suggestion.category in preferred_categories:
            score *= 1.5
        
        # Буст за недавние запросы
        if suggestion.text in user_history.recent_queries:
            score *= 1.3
        
        scored.append((suggestion, score))
    
    # Сортируем и возвращаем
    scored.sort(key=lambda x: -x[1])
    return [s[0] for s in scored]
```

## 5. Оптимизации производительности

### 5.1 Кэширование

```python
class SearchCache:
    """
    Многоуровневое кэширование
    """
    
    def __init__(self, redis_client):
        self.redis = redis_client
        self.local_cache = LRUCache(maxsize=1000)  # L1 - память
    
    def get(self, project_id: str, query: str) -> Optional[SearchResult]:
        cache_key = f"search:{project_id}:{hash(query)}"
        
        # L1 - локальный кэш (< 1ms)
        if cache_key in self.local_cache:
            return self.local_cache[cache_key]
        
        # L2 - Redis (< 5ms)
        cached = self.redis.get(cache_key)
        if cached:
            result = deserialize(cached)
            self.local_cache[cache_key] = result
            return result
        
        return None
    
    def set(self, project_id: str, query: str, result: SearchResult):
        cache_key = f"search:{project_id}:{hash(query)}"
        
        # Время жизни зависит от популярности запроса
        ttl = 300 if self.is_popular(query) else 60
        
        self.local_cache[cache_key] = result
        self.redis.setex(cache_key, ttl, serialize(result))
```

### 5.2 Инвалидация кэша при обновлении фида

```python
def invalidate_cache_on_feed_update(project_id: str, updated_products: List[str]):
    """
    Умная инвалидация кэша
    """
    
    # Для delta-фида: инвалидируем только запросы с изменёнными товарами
    if is_delta_update:
        for product_id in updated_products:
            # Находим запросы, где был этот товар
            affected_queries = get_queries_with_product(project_id, product_id)
            for query in affected_queries:
                cache.delete(project_id, query)
    
    # Для полного фида: инвалидируем весь кэш проекта
    else:
        cache.delete_pattern(f"search:{project_id}:*")
```

### 5.3 Предварительный расчёт популярных запросов

```python
async def precompute_popular_queries(project_id: str):
    """
    Предварительный расчёт результатов для популярных запросов
    """
    
    # Получаем топ-100 запросов за последние 24 часа
    popular_queries = analytics.get_popular_queries(
        project_id, 
        period='24h', 
        limit=100
    )
    
    for query in popular_queries:
        # Выполняем поиск и кэшируем с длинным TTL
        result = search_engine.search(project_id, query)
        cache.set(project_id, query, result, ttl=3600)
```

## 6. Метрики качества поиска

```python
@dataclass
class SearchMetrics:
    # Релевантность
    precision_at_k: float     # Точность в топ-K
    recall: float             # Полнота
    ndcg: float               # Normalized DCG
    
    # Бизнес-метрики
    click_through_rate: float # CTR
    conversion_rate: float    # Конверсия
    zero_results_rate: float  # Доля пустых выдач
    
    # Технические
    avg_response_time: float  # Среднее время ответа
    p95_response_time: float  # 95-й перцентиль
    cache_hit_rate: float     # Процент попаданий в кэш
```
