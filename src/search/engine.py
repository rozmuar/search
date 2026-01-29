"""
Поисковый движок
"""
import math
import hashlib
from typing import List, Dict, Any, Optional, Set
from dataclasses import dataclass
from collections import defaultdict

from ..core.models import Product, SearchResult, SuggestResult, Suggestion
from ..core.interfaces import ISearchEngine, ICache
from .query_processor import QueryProcessor, NGramGenerator


@dataclass
class RankingFactors:
    """Факторы для ранжирования"""
    text_match_score: float = 0.0
    position_score: float = 0.0
    exact_match_bonus: float = 0.0
    in_stock: bool = True
    price_score: float = 0.0
    discount_score: float = 0.0
    popularity: float = 0.0


class SearchEngine(ISearchEngine):
    """
    Поисковый движок
    
    Использует Redis для хранения индексов:
    - Инвертированный индекс (токен -> товары)
    - N-gram индекс (для частичного совпадения)
    - Prefix-индекс (для подсказок)
    """
    
    def __init__(
        self,
        redis_client,
        query_processor: QueryProcessor,
        cache: Optional[ICache] = None,
        config: dict = None,
    ):
        self.redis = redis_client
        self.query_processor = query_processor
        self.cache = cache
        self.config = config or {}
        self.ngram_gen = NGramGenerator(n=3)
        
        # Веса для ранжирования
        self.weights = {
            "text": self.config.get("text_weight", 0.4),
            "stock": self.config.get("stock_weight", 0.2),
            "popularity": self.config.get("popularity_weight", 0.2),
            "commercial": self.config.get("commercial_weight", 0.2),
        }
    
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
        """
        import time
        start_time = time.time()
        
        # Проверяем кэш
        cache_key = self._make_cache_key(query, limit, offset, filters, sort)
        if self.cache:
            cached = await self.cache.get_search_result(project_id, cache_key)
            if cached:
                return cached
        
        # Обрабатываем запрос
        search_query = self.query_processor.process(query, project_id)
        
        if not search_query.tokens:
            return SearchResult(
                query=query,
                total=0,
                items=[],
                took_ms=int((time.time() - start_time) * 1000)
            )
        
        # Поиск по инвертированному индексу
        product_scores = await self._search_inverted_index(
            project_id, 
            search_query.tokens
        )
        
        # Если мало результатов, пробуем n-gram поиск
        if len(product_scores) < limit:
            ngram_scores = await self._search_ngram_index(
                project_id,
                search_query.tokens
            )
            # Объединяем результаты
            for pid, score in ngram_scores.items():
                if pid not in product_scores:
                    product_scores[pid] = score * 0.8  # Немного снижаем вес n-gram
        
        # Загружаем данные товаров
        products = await self._load_products(project_id, list(product_scores.keys()))
        
        # Применяем фильтры
        if filters:
            products = self._apply_filters(products, filters)
        
        # Рассчитываем итоговый скор и ранжируем
        ranked_products = self._rank_products(
            products, 
            product_scores, 
            search_query.tokens
        )
        
        # Сортировка
        if sort == "price_asc":
            ranked_products.sort(key=lambda p: p.price)
        elif sort == "price_desc":
            ranked_products.sort(key=lambda p: -p.price)
        elif sort == "popular":
            ranked_products.sort(key=lambda p: -p.popularity)
        # По умолчанию - по релевантности (уже отсортировано)
        
        # Пагинация
        total = len(ranked_products)
        items = ranked_products[offset:offset + limit]
        
        # Подсвечиваем совпадения
        items = self._highlight_matches(items, search_query.tokens)
        
        # Собираем фасеты
        facets = self._build_facets(ranked_products)
        
        result = SearchResult(
            query=query,
            total=total,
            items=items,
            facets=facets,
            took_ms=int((time.time() - start_time) * 1000),
            query_corrected=search_query.corrected,
            corrected_query=search_query.normalized_query if search_query.corrected else None
        )
        
        # Сохраняем в кэш
        if self.cache:
            await self.cache.set_search_result(project_id, cache_key, result)
        
        return result
    
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
        """
        import time
        start_time = time.time()
        
        # Нормализуем префикс
        prefix = self.query_processor.normalize(prefix)
        
        if len(prefix) < 2:
            return SuggestResult(prefix=prefix, took_ms=0)
        
        # 1. Подсказки запросов из индекса популярных запросов
        query_suggestions = await self._get_query_suggestions(project_id, prefix, limit)
        
        # 2. Категории (если включено)
        categories = []
        if include_categories:
            categories = await self._get_category_suggestions(project_id, prefix, 3)
        
        # 3. Товары (если включено)
        products = []
        if include_products:
            products = await self._get_product_suggestions(project_id, prefix, 4)
        
        return SuggestResult(
            prefix=prefix,
            queries=query_suggestions,
            categories=categories,
            products=products,
            took_ms=int((time.time() - start_time) * 1000)
        )
    
    async def get_product(
        self,
        project_id: str,
        product_id: str
    ) -> Optional[Product]:
        """Получить товар по ID"""
        key = f"products:{project_id}:{product_id}"
        data = await self.redis.get(key)
        if data:
            return self._deserialize_product(data)
        return None
    
    async def get_similar_products(
        self,
        project_id: str,
        product_id: str,
        limit: int = 10
    ) -> List[Product]:
        """
        Получить похожие товары
        
        Алгоритм:
        1. Получаем товар
        2. Берём его категорию и бренд
        3. Ищем товары в той же категории
        4. Фильтруем по похожей цене
        """
        product = await self.get_product(project_id, product_id)
        if not product:
            return []
        
        # Ищем по категории
        filters = {}
        if product.category:
            filters["category"] = product.category
        
        # Ценовой диапазон ±30%
        if product.price > 0:
            filters["price_min"] = product.price * 0.7
            filters["price_max"] = product.price * 1.3
        
        # Поиск по названию бренда или категории
        query = product.brand or product.category or ""
        if query:
            result = await self.search(
                project_id, 
                query, 
                limit=limit + 1,  # +1 чтобы исключить сам товар
                filters=filters
            )
            
            # Исключаем сам товар
            return [p for p in result.items if p.id != product_id][:limit]
        
        return []
    
    # ==================== Приватные методы ====================
    
    async def _search_inverted_index(
        self, 
        project_id: str, 
        tokens: List[str]
    ) -> Dict[str, float]:
        """
        Поиск по инвертированному индексу
        """
        product_scores = defaultdict(float)
        
        for token in tokens:
            key = f"idx:{project_id}:inv:{token}"
            # ZRANGE с scores
            results = await self.redis.zrange(key, 0, -1, withscores=True)
            
            for product_id, score in results:
                product_scores[product_id] += score
        
        return dict(product_scores)
    
    async def _search_ngram_index(
        self, 
        project_id: str, 
        tokens: List[str]
    ) -> Dict[str, float]:
        """
        Поиск по n-gram индексу (для частичного совпадения)
        """
        product_scores = defaultdict(float)
        
        for token in tokens:
            # Генерируем n-граммы для токена
            ngrams = self.ngram_gen.generate(token)
            
            # Ищем слова, содержащие эти n-граммы
            matching_tokens = set()
            for ngram in ngrams:
                key = f"idx:{project_id}:ngram:{ngram}"
                words = await self.redis.smembers(key)
                matching_tokens.update(words)
            
            # Для каждого найденного слова ищем товары
            for matched_token in matching_tokens:
                # Рассчитываем схожесть
                similarity = self._token_similarity(token, matched_token)
                if similarity > 0.5:  # Минимальный порог
                    key = f"idx:{project_id}:inv:{matched_token}"
                    results = await self.redis.zrange(key, 0, -1, withscores=True)
                    
                    for product_id, score in results:
                        product_scores[product_id] += score * similarity
        
        return dict(product_scores)
    
    def _token_similarity(self, token1: str, token2: str) -> float:
        """
        Расчёт схожести двух токенов через коэффициент Жаккара на n-граммах
        """
        ngrams1 = set(self.ngram_gen.generate(token1))
        ngrams2 = set(self.ngram_gen.generate(token2))
        
        intersection = len(ngrams1 & ngrams2)
        union = len(ngrams1 | ngrams2)
        
        if union == 0:
            return 0.0
        
        return intersection / union
    
    async def _load_products(
        self, 
        project_id: str, 
        product_ids: List[str]
    ) -> List[Product]:
        """
        Загрузка данных товаров из Redis
        """
        if not product_ids:
            return []
        
        # Batch загрузка
        keys = [f"products:{project_id}:{pid}" for pid in product_ids]
        values = await self.redis.mget(keys)
        
        products = []
        for value in values:
            if value:
                products.append(self._deserialize_product(value))
        
        return products
    
    def _deserialize_product(self, data: str) -> Product:
        """Десериализация товара из JSON"""
        import json
        d = json.loads(data)
        return Product(**d)
    
    def _apply_filters(
        self, 
        products: List[Product], 
        filters: Dict[str, Any]
    ) -> List[Product]:
        """
        Применение фильтров к списку товаров
        """
        result = products
        
        # Фильтр по наличию
        if filters.get("in_stock"):
            result = [p for p in result if p.in_stock]
        
        # Фильтр по цене
        if "price_min" in filters:
            result = [p for p in result if p.price >= filters["price_min"]]
        if "price_max" in filters:
            result = [p for p in result if p.price <= filters["price_max"]]
        
        # Фильтр по категории
        if "category" in filters:
            category = filters["category"].lower()
            result = [p for p in result if p.category and category in p.category.lower()]
        
        # Фильтр по бренду
        if "brand" in filters:
            brand = filters["brand"].lower()
            result = [p for p in result if p.brand and p.brand.lower() == brand]
        
        return result
    
    def _rank_products(
        self,
        products: List[Product],
        base_scores: Dict[str, float],
        query_tokens: List[str]
    ) -> List[Product]:
        """
        Ранжирование товаров по множеству факторов
        """
        scored_products = []
        
        # Максимальные значения для нормализации
        max_price = max((p.price for p in products), default=1) or 1
        max_popularity = max((p.popularity for p in products), default=1) or 1
        
        for product in products:
            factors = RankingFactors()
            
            # 1. Текстовая релевантность (из базового скора)
            factors.text_match_score = base_scores.get(product.id, 0)
            
            # 2. Позиционный скор (совпадение в начале важнее)
            factors.position_score = self._calc_position_score(product.name, query_tokens)
            
            # 3. Бонус за точное совпадение
            query_str = " ".join(query_tokens)
            if query_str.lower() in product.name.lower():
                factors.exact_match_bonus = 1.0
            
            # 4. Наличие
            factors.in_stock = product.in_stock
            
            # 5. Ценовой скор (нормализованный)
            factors.price_score = product.price / max_price
            
            # 6. Скор скидки
            if product.discount_percent:
                factors.discount_score = product.discount_percent / 100
            
            # 7. Популярность
            factors.popularity = product.popularity / max_popularity
            
            # Итоговый скор
            final_score = self._calculate_final_score(factors)
            
            scored_products.append((product, final_score))
        
        # Сортируем по скору
        scored_products.sort(key=lambda x: -x[1])
        
        return [p for p, _ in scored_products]
    
    def _calc_position_score(self, text: str, tokens: List[str]) -> float:
        """
        Позиционный скор - чем раньше совпадение, тем выше скор
        """
        text_lower = text.lower()
        min_position = len(text)
        
        for token in tokens:
            pos = text_lower.find(token)
            if pos >= 0 and pos < min_position:
                min_position = pos
        
        if min_position == len(text):
            return 0.0
        
        # Нормализуем: позиция 0 -> 1.0, позиция в конце -> 0.0
        return 1.0 - (min_position / len(text))
    
    def _calculate_final_score(self, factors: RankingFactors) -> float:
        """
        Расчёт итогового скора
        """
        # Текстовая релевантность
        text_score = (
            factors.text_match_score * 0.5 +
            factors.position_score * 0.3 +
            factors.exact_match_bonus * 0.2
        )
        
        # Буст за наличие
        stock_multiplier = 1.0 if factors.in_stock else 0.3
        
        # Популярность
        popularity_score = factors.popularity
        
        # Коммерческий скор
        commercial_score = (
            factors.discount_score * 0.6 +
            (1 - factors.price_score) * 0.4
        )
        
        # Итоговый скор
        final = (
            text_score * self.weights["text"] +
            popularity_score * self.weights["popularity"] +
            commercial_score * self.weights["commercial"]
        ) * stock_multiplier
        
        return final
    
    def _highlight_matches(
        self, 
        products: List[Product], 
        tokens: List[str]
    ) -> List[Product]:
        """
        Подсветка совпадений в названиях
        """
        import re
        
        for product in products:
            highlighted_name = product.name
            for token in tokens:
                # Ищем токен без учёта регистра
                pattern = re.compile(re.escape(token), re.IGNORECASE)
                highlighted_name = pattern.sub(
                    lambda m: f"<em>{m.group()}</em>",
                    highlighted_name
                )
            # Сохраняем в атрибуты (для шаблона)
            product.attributes["_highlighted_name"] = highlighted_name
        
        return products
    
    def _build_facets(self, products: List[Product]) -> Dict[str, Any]:
        """
        Построение фасетов (агрегаций) для фильтров
        """
        categories = defaultdict(int)
        brands = defaultdict(int)
        prices = []
        
        for product in products:
            if product.category:
                categories[product.category] += 1
            if product.brand:
                brands[product.brand] += 1
            if product.price > 0:
                prices.append(product.price)
        
        # Ценовые диапазоны
        price_ranges = []
        if prices:
            min_price = min(prices)
            max_price = max(prices)
            step = (max_price - min_price) / 4 or 1
            
            for i in range(4):
                range_min = min_price + step * i
                range_max = min_price + step * (i + 1)
                count = len([p for p in prices if range_min <= p < range_max])
                price_ranges.append({
                    "min": round(range_min),
                    "max": round(range_max),
                    "count": count
                })
        
        return {
            "categories": [
                {"value": k, "count": v}
                for k, v in sorted(categories.items(), key=lambda x: -x[1])[:10]
            ],
            "brands": [
                {"value": k, "count": v}
                for k, v in sorted(brands.items(), key=lambda x: -x[1])[:10]
            ],
            "price_ranges": price_ranges
        }
    
    async def _get_query_suggestions(
        self, 
        project_id: str, 
        prefix: str, 
        limit: int
    ) -> List[Suggestion]:
        """
        Получение подсказок запросов
        """
        # Ищем в индексе популярных запросов
        key = f"idx:{project_id}:suggest:{prefix[:3]}"  # Используем первые 3 символа
        results = await self.redis.zrevrange(key, 0, limit * 2, withscores=True)
        
        suggestions = []
        for query_text, count in results:
            if query_text.startswith(prefix):
                highlighted = f"<em>{prefix}</em>{query_text[len(prefix):]}"
                suggestions.append(Suggestion(
                    text=query_text,
                    count=int(count),
                    highlight=highlighted,
                    type="query"
                ))
                
                if len(suggestions) >= limit:
                    break
        
        return suggestions
    
    async def _get_category_suggestions(
        self,
        project_id: str,
        prefix: str,
        limit: int
    ) -> List[Dict]:
        """
        Получение подсказок категорий
        """
        key = f"idx:{project_id}:categories"
        all_categories = await self.redis.hgetall(key)
        
        suggestions = []
        prefix_lower = prefix.lower()
        
        for category, count in all_categories.items():
            if prefix_lower in category.lower():
                suggestions.append({
                    "name": category,
                    "count": int(count),
                    "url": f"/category/{category.lower().replace(' ', '-')}"
                })
        
        # Сортируем по количеству
        suggestions.sort(key=lambda x: -x["count"])
        return suggestions[:limit]
    
    async def _get_product_suggestions(
        self,
        project_id: str,
        prefix: str,
        limit: int
    ) -> List[Product]:
        """
        Получение товаров для подсказок
        """
        # Быстрый поиск по префиксу
        result = await self.search(project_id, prefix, limit=limit)
        return result.items
    
    def _make_cache_key(
        self,
        query: str,
        limit: int,
        offset: int,
        filters: Optional[Dict],
        sort: str
    ) -> str:
        """
        Создание ключа кэша
        """
        parts = [query, str(limit), str(offset), sort]
        if filters:
            parts.append(str(sorted(filters.items())))
        
        key_str = "|".join(parts)
        return hashlib.md5(key_str.encode()).hexdigest()
