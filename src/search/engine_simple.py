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
        sort: str = "relevance"
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
        
        # Применяем фильтры
        filtered_products = await self._apply_filters(
            project_id,
            sorted_products,
            filters
        )
        
        # Пагинация
        total = len(filtered_products)
        paginated = filtered_products[offset:offset + limit]
        
        # Загружаем полные данные товаров
        items = await self._load_products(project_id, paginated)
        
        took_ms = int((time.time() - start_time) * 1000)
        
        return SearchResult(
            query=query,
            total=total,
            items=items,
            took_ms=took_ms
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
        
        # Диагностика: сколько всего ключей в индексе
        total_idx_keys = await self.redis.keys(f"idx:{project_id}:inv:*")
        logger.info(f"[SEARCH] Total inverted index keys: {len(total_idx_keys)}")
        
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
    
    async def _apply_filters(
        self,
        project_id: str,
        products: List[tuple],
        filters: Optional[Dict[str, Any]]
    ) -> List[tuple]:
        """Применение фильтров"""
        if not filters:
            return products
        
        filtered = []
        
        for product_id, score in products:
            # Загружаем данные товара
            key = f"products:{project_id}:{product_id}"
            data = await self.redis.get(key)
            
            if not data:
                continue
            
            product = json.loads(data)
            
            # Проверяем фильтры
            if filters.get("in_stock") and not product.get("in_stock"):
                continue
            
            if filters.get("price_min") and product.get("price", 0) < filters["price_min"]:
                continue
            
            if filters.get("price_max") and product.get("price", 0) > filters["price_max"]:
                continue
            
            if filters.get("category") and product.get("category") != filters["category"]:
                continue
            
            filtered.append((product_id, score))
        
        return filtered
    
    async def _load_products(
        self,
        project_id: str,
        products: List[tuple]
    ) -> List[Dict[str, Any]]:
        """Загрузка полных данных товаров"""
        items = []
        
        for product_id, score in products:
            key = f"products:{project_id}:{product_id}"
            data = await self.redis.get(key)
            
            if data:
                product = json.loads(data)
                product["score"] = round(score, 2)
                items.append(product)
        
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