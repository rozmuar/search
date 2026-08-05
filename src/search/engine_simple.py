"""
Упрощенный поисковый движок без ML
Классический BM25-подобный поиск
"""
import json
import math
import logging
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
from collections import defaultdict

logger = logging.getLogger(__name__)


@dataclass
class SearchResult:
    """Результат поиска"""
    query: str
    total: int
    items: List[Dict[str, Any]]
    took_ms: int
    suggestions: List[str] = None
    facets: Optional[Dict[str, Any]] = None


@dataclass
class SuggestResult:
    """Результат подсказок"""
    prefix: str
    suggestions: List[str]
    products: List[Dict[str, Any]] = None


class SimpleSearchEngine:
    """
    Упрощенный поисковый движок
    
    Использует Redis для хранения индексов:
    - Инвертированный индекс (токен -> товары со скорами)
    - N-gram индекс (для частичного совпадения)
    - Prefix-индекс (для подсказок)
    """
    
    def __init__(self, redis_client, query_processor, ngram_gen):
        self.redis = redis_client
        self.query_processor = query_processor
        self.ngram_gen = ngram_gen
    
    async def search(
        self,
        project_id: str,
        query: str,
        limit: int = 20,
        offset: int = 0,
        filters: Optional[Dict[str, Any]] = None,
        sort: str = "relevance",
        facets: bool = False
    ) -> SearchResult:
        """Выполнить поиск товаров"""
        import time
        start_time = time.time()
        
        # Обрабатываем запрос
        search_query = self.query_processor.process(query)
        
        logger.info(f"[SEARCH] Query: '{query}' -> tokens: {search_query.tokens}")
        
        if not search_query.tokens:
            return SearchResult(
                query=query,
                total=0,
                items=[],
                took_ms=int((time.time() - start_time) * 1000)
            )
        
        # Загружаем синонимы проекта
        synonyms = await self._load_synonyms(project_id)
        
        # Расширяем токены синонимами
        expanded_tokens = self._expand_with_synonyms(search_query.tokens, synonyms)
        
        logger.info(f"[SEARCH] Expanded tokens (with synonyms): {expanded_tokens}")
        
        # Поиск по инвертированному индексу
        product_scores = await self._search_inverted_index(
            project_id,
            expanded_tokens
        )
        
        logger.info(f"[SEARCH] Found {len(product_scores)} products in inverted index")
        
        # Если мало результатов, пробуем с другой раскладкой
        if len(product_scores) < limit and search_query.layout_variants:
            for variant in search_query.layout_variants:
                variant_tokens = self.query_processor.tokenize(variant)
                if variant_tokens:
                    variant_scores = await self._search_inverted_index(
                        project_id,
                        variant_tokens
                    )
                    # Объединяем результаты (с меньшим весом для раскладки)
                    for pid, score in variant_scores.items():
                        if pid not in product_scores:
                            product_scores[pid] = score * 0.9  # Немного снижаем релевантность
                        # Если уже есть - не перезаписываем
        
        # Если мало результатов, пробуем n-gram поиск
        if len(product_scores) < limit:
            ngram_scores = await self._search_ngram_index(
                project_id,
                search_query.tokens
            )
            # Объединяем результаты
            for prod_id, score in ngram_scores.items():
                if prod_id not in product_scores:
                    product_scores[prod_id] = score * 0.5  # Снижаем вес n-gram
        
        # Сортируем по скору
        sorted_products = sorted(
            product_scores.items(),
            key=lambda x: x[1],
            reverse=True
        )
        
        # Применяем фильтры (+ считаем фасеты, если запрошены)
        force_load = sort in ("price_asc", "price_desc")
        filtered_products, facets_payload, product_cache = await self._apply_filters_and_facets(
            project_id,
            sorted_products,
            filters,
            compute_facets=facets,
            force_load=force_load
        )

        if sort == "price_asc":
            filtered_products.sort(key=lambda t: product_cache.get(t[0], {}).get("price") or 0)
        elif sort == "price_desc":
            filtered_products.sort(key=lambda t: product_cache.get(t[0], {}).get("price") or 0, reverse=True)

        # Пагинация
        total = len(filtered_products)
        paginated = filtered_products[offset:offset + limit]

        # Загружаем полные данные товаров
        items = await self._load_products(project_id, paginated, product_cache)

        took_ms = int((time.time() - start_time) * 1000)

        return SearchResult(
            query=query,
            total=total,
            items=items,
            took_ms=took_ms,
            facets=facets_payload
        )
    
    async def suggest(
        self,
        project_id: str,
        prefix: str,
        limit: int = 10,
        include_products: bool = True
    ) -> SuggestResult:
        """Получить подсказки для автодополнения"""
        normalized = self.query_processor.normalize(prefix)
        
        # Ищем в индексе подсказок
        key = f"idx:{project_id}:suggest"
        
        # Получаем все подсказки с префиксом
        all_suggestions = await self.redis.zrevrange(key, 0, -1, withscores=True)
        
        # Фильтруем по префиксу
        matching = [
            (sug.decode() if isinstance(sug, bytes) else sug, score)
            for sug, score in all_suggestions
            if (sug.decode() if isinstance(sug, bytes) else sug).startswith(normalized)
        ]
        
        # Сортируем по популярности и берем топ
        suggestions = [sug for sug, _ in sorted(matching, key=lambda x: x[1], reverse=True)[:limit]]
        
        products = []
        if include_products:
            # Если есть подсказки - ищем по первой, иначе ищем по оригинальному запросу
            search_query = suggestions[0] if suggestions else prefix
            result = await self.search(project_id, search_query, limit=8)
            products = result.items
        
        return SuggestResult(
            prefix=prefix,
            suggestions=suggestions,
            products=products
        )
    
    async def search_by_field(
        self,
        project_id: str,
        field: str,
        value: str,
        limit: int = 4,
        exclude_ids: List[str] = None
    ) -> List[Dict[str, Any]]:
        """Поиск товаров по конкретному полю (для связанных товаров)"""
        exclude_ids = exclude_ids or []
        
        # Проверяем, это вложенное поле типа params.Цвет?
        is_params_field = field.startswith("params.")
        actual_field = field[7:] if is_params_field else field  # убираем "params."
        
        # Получаем все ключи товаров проекта
        pattern = f"products:{project_id}:*"
        cursor = 0
        matching_products = []
        
        while True:
            cursor, keys = await self.redis.scan(cursor, match=pattern, count=100)
            
            for key in keys:
                product_data = await self.redis.get(key)
                if not product_data:
                    continue
                
                try:
                    product = json.loads(product_data if isinstance(product_data, str) else product_data.decode())
                    
                    # Пропускаем исключённые
                    if product.get("id") in exclude_ids:
                        continue
                    
                    product_value = None
                    
                    if is_params_field:
                        # Ищем в params
                        product_value = product.get("params", {}).get(actual_field)
                    else:
                        # Ищем в основных полях
                        product_value = product.get(field)
                        # Если не нашли - пробуем в params
                        if not product_value and "params" in product:
                            product_value = product.get("params", {}).get(field)
                    
                    if product_value and str(product_value).lower() == str(value).lower():
                        matching_products.append(product)
                        
                        if len(matching_products) >= limit:
                            return matching_products
                except:
                    continue
            
            if cursor == 0:
                break
        
        return matching_products
    
    async def _search_inverted_index(
        self,
        project_id: str,
        tokens: List[str]
    ) -> Dict[str, float]:
        """Поиск по инвертированному индексу"""
        product_scores = defaultdict(float)

        for token in tokens:
            key = f"idx:{project_id}:inv:{token}"
            
            # Получаем товары с этим токеном
            results = await self.redis.zrevrange(key, 0, -1, withscores=True)
            
            logger.info(f"[SEARCH] Token '{token}' -> found {len(results)} products")
            
            for product_id, score in results:
                if isinstance(product_id, bytes):
                    product_id = product_id.decode()
                product_scores[product_id] += score
        
        return dict(product_scores)
    
    async def _search_ngram_index(
        self,
        project_id: str,
        tokens: List[str]
    ) -> Dict[str, float]:
        """Поиск по n-gram индексу (для частичного совпадения)"""
        product_scores = defaultdict(float)
        
        for token in tokens:
            # Генерируем n-граммы
            ngrams = self.ngram_gen.generate(token)
            
            # Для каждой n-граммы ищем токены
            matching_tokens = set()
            for ngram in ngrams:
                key = f"idx:{project_id}:ngram:{ngram}"
                tokens_set = await self.redis.smembers(key)
                for t in tokens_set:
                    if isinstance(t, bytes):
                        t = t.decode()
                    matching_tokens.add(t)
            
            # Для каждого найденного токена ищем товары
            for matched_token in matching_tokens:
                key = f"idx:{project_id}:inv:{matched_token}"
                results = await self.redis.zrevrange(key, 0, -1, withscores=True)
                
                for product_id, score in results:
                    if isinstance(product_id, bytes):
                        product_id = product_id.decode()
                    # Рассчитываем сходство токенов
                    similarity = self._token_similarity(token, matched_token)
                    product_scores[product_id] += score * similarity
        
        return dict(product_scores)
    
    def _token_similarity(self, token1: str, token2: str) -> float:
        """Простая мера схожести токенов"""
        if token1 == token2:
            return 1.0
        
        # Jaccard сходство n-gram
        ngrams1 = set(self.ngram_gen.generate(token1))
        ngrams2 = set(self.ngram_gen.generate(token2))
        
        intersection = len(ngrams1 & ngrams2)
        union = len(ngrams1 | ngrams2)
        
        return intersection / union if union > 0 else 0.0
    
    # Пороги авто-определения фасетируемых параметров (см. docs/search-algorithm.md)
    FACET_MIN_COVERAGE = 0.05
    FACET_MAX_DISTINCT_RATIO = 0.8
    FACET_MAX_GROUPS = 8
    FACET_MAX_VALUES_PER_GROUP = 20

    @staticmethod
    def _as_list(value: Any) -> list:
        if value is None:
            return []
        if isinstance(value, list):
            return value
        return [value]

    async def _apply_filters_and_facets(
        self,
        project_id: str,
        products: List[tuple],
        filters: Optional[Dict[str, Any]],
        compute_facets: bool = False,
        force_load: bool = False
    ) -> tuple:
        """
        Применение фильтров и (опционально) расчёт фасетов - за один проход,
        без лишних round-trip'ов к Redis (данные уже грузятся для проверки фильтров).

        Возвращает (filtered, facets_or_None, product_cache), где product_cache -
        уже распарсенные товары, чтобы _load_products их не грузил повторно.
        """
        if not filters and not compute_facets and not force_load:
            return products, None, {}

        if not products:
            empty_facets = self._build_facets_payload({}, None, None, {}, {}, 0) if compute_facets else None
            return [], empty_facets, {}

        filters = filters or {}

        # Батч-загрузка всех кандидатов одним round-trip вместо N последовательных GET
        keys = [f"products:{project_id}:{pid}" for pid, _ in products]
        raw_values = await self.redis.mget(keys)

        product_cache: Dict[str, dict] = {}
        for (product_id, _), data in zip(products, raw_values):
            if not data:
                continue
            try:
                product_cache[product_id] = json.loads(data)
            except (json.JSONDecodeError, TypeError):
                continue

        category_filter = self._as_list(filters.get("category"))
        in_stock_filter = filters.get("in_stock")
        min_price = filters.get("min_price")
        max_price = filters.get("max_price")
        params_filter = filters.get("params") or {}

        filtered = []
        category_counts: Dict[str, int] = defaultdict(int)
        params_counts: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
        params_products_with: Dict[str, int] = defaultdict(int)
        price_min_ex = None  # границы цены считаются БЕЗ учёта фильтра по цене,
        price_max_ex = None  # иначе слайдер нельзя было бы раздвинуть обратно

        for product_id, score in products:
            product = product_cache.get(product_id)
            if not product:
                continue

            price = product.get("price") or 0

            passes_non_price = True
            if in_stock_filter and not product.get("in_stock"):
                passes_non_price = False
            if passes_non_price and category_filter and product.get("category") not in category_filter:
                passes_non_price = False
            if passes_non_price and params_filter:
                product_params = product.get("params") or {}
                for key, allowed in params_filter.items():
                    allowed_list = self._as_list(allowed)
                    if allowed_list and product_params.get(key) not in allowed_list:
                        passes_non_price = False
                        break

            if compute_facets and passes_non_price:
                if price_min_ex is None or price < price_min_ex:
                    price_min_ex = price
                if price_max_ex is None or price > price_max_ex:
                    price_max_ex = price

            passes_price = True
            if min_price is not None and price < min_price:
                passes_price = False
            if max_price is not None and price > max_price:
                passes_price = False

            passes = passes_non_price and passes_price

            if passes and compute_facets:
                category = product.get("category")
                if category:
                    category_counts[category] += 1

                product_params = product.get("params") or {}
                for key, value in product_params.items():
                    if not value:
                        continue
                    params_counts[key][value] += 1
                    params_products_with[key] += 1

            if passes:
                filtered.append((product_id, score))

        facets_payload = None
        if compute_facets:
            facets_payload = self._build_facets_payload(
                category_counts, price_min_ex, price_max_ex,
                params_counts, params_products_with,
                total_passing=len(filtered)
            )

        return filtered, facets_payload, product_cache

    def _build_facets_payload(
        self,
        category_counts: Dict[str, int],
        price_min: Optional[float],
        price_max: Optional[float],
        params_counts: Dict[str, Dict[str, int]],
        params_products_with: Dict[str, int],
        total_passing: int
    ) -> Dict[str, Any]:
        """Формирует финальный JSON фасетов из накопленных счётчиков"""
        categories = [
            {"value": cat, "count": count}
            for cat, count in sorted(category_counts.items(), key=lambda x: -x[1])
        ]

        price = None
        if price_min is not None and price_max is not None:
            price = {"min": price_min, "max": price_max}

        params_facets = {}
        if params_counts and total_passing:
            candidates = []
            for key, value_counts in params_counts.items():
                products_with = params_products_with.get(key, 0)
                if products_with == 0:
                    continue
                coverage = products_with / total_passing
                distinct_ratio = len(value_counts) / products_with
                if coverage < self.FACET_MIN_COVERAGE:
                    continue
                if distinct_ratio > self.FACET_MAX_DISTINCT_RATIO:
                    continue
                candidates.append((key, coverage, value_counts))

            candidates.sort(key=lambda x: -x[1])
            for key, _, value_counts in candidates[:self.FACET_MAX_GROUPS]:
                top_values = sorted(value_counts.items(), key=lambda x: (-x[1], x[0]))
                top_values = top_values[:self.FACET_MAX_VALUES_PER_GROUP]
                params_facets[key] = [{"value": v, "count": c} for v, c in top_values]

        return {
            "categories": categories,
            "price": price,
            "params": params_facets
        }

    async def _load_products(
        self,
        project_id: str,
        products: List[tuple],
        product_cache: Optional[Dict[str, dict]] = None
    ) -> List[Dict[str, Any]]:
        """Загрузка полных данных товаров (переиспользует уже распарсенный product_cache)"""
        product_cache = dict(product_cache) if product_cache else {}

        missing = [(pid, score) for pid, score in products if pid not in product_cache]
        if missing:
            keys = [f"products:{project_id}:{pid}" for pid, _ in missing]
            raw_values = await self.redis.mget(keys)
            for (pid, _), data in zip(missing, raw_values):
                if not data:
                    continue
                try:
                    product_cache[pid] = json.loads(data)
                except (json.JSONDecodeError, TypeError):
                    continue

        items = []
        for product_id, score in products:
            product = product_cache.get(product_id)
            if product:
                item = dict(product)
                item["score"] = round(score, 2)
                items.append(item)

        return items
    
    async def _load_synonyms(self, project_id: str) -> List[List[str]]:
        """Загрузка синонимов проекта"""
        try:
            synonyms_key = f"synonyms:{project_id}"
            synonyms_data = await self.redis.get(synonyms_key)
            
            if synonyms_data:
                data = synonyms_data.decode() if isinstance(synonyms_data, bytes) else synonyms_data
                return json.loads(data)
        except Exception as e:
            print(f"Error loading synonyms: {e}")
        
        return []
    
    def _expand_with_synonyms(self, tokens: List[str], synonyms: List[List[str]]) -> List[str]:
        """Расширяет токены синонимами"""
        if not synonyms:
            return tokens
        
        expanded = list(tokens)  # Копия оригинальных токенов
        
        for token in tokens:
            token_lower = token.lower()
            # Ищем токен в группах синонимов
            for group in synonyms:
                if token_lower in [w.lower() for w in group]:
                    # Добавляем все синонимы из группы
                    for synonym in group:
                        if synonym.lower() not in [t.lower() for t in expanded]:
                            expanded.append(synonym.lower())
                    break
        
        return expanded