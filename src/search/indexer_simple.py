"""
Упрощенный индексатор без ML
"""
import json
from typing import List, Dict, Any, Set
from collections import defaultdict

from ..core.models import Product


class SimpleIndexer:
    """
    Базовый индексатор товаров
    
    Строит:
    - Инвертированный индекс (токен -> товары со скорами)
    - N-gram индекс (для частичного совпадения)
    - Индекс подсказок (для автодополнения)
    """
    
    def __init__(self, redis_client, query_processor, ngram_gen):
        self.redis = redis_client
        self.query_processor = query_processor
        self.ngram_gen = ngram_gen
    
    async def index_products(self, project_id: str, products: List[Product]) -> int:
        """Полная индексация товаров"""
        if not products:
            return 0
        
        # Подготовка данных
        products_data = {}
        inverted_index = defaultdict(dict)
        ngram_index = defaultdict(set)
        suggest_index = defaultdict(int)
        
        for product in products:
            # Сохраняем товар
            product_key = f"products:{project_id}:{product.id}"
            
            # Получаем params если есть (из Product или словаря)
            params = {}
            if hasattr(product, 'params') and product.params:
                params = product.params
            elif hasattr(product, '__dict__') and 'params' in product.__dict__:
                params = product.__dict__['params'] or {}
            
            products_data[product_key] = json.dumps({
                "id": product.id,
                "name": product.name,
                "description": product.description or "",
                "url": product.url,
                "image": product.image,
                "price": product.price,
                "old_price": product.old_price,
                "in_stock": product.in_stock,
                "category": product.category,
                "brand": product.brand,
                "vendor_code": getattr(product, 'vendor_code', ''),
                "params": params
            })
            
            # Получаем токены
            tokens = self._extract_tokens(product)
            
            # Строим инвертированный индекс
            for token, score in tokens.items():
                inverted_index[token][product.id] = score
                
                # N-gram индекс
                for ngram in self.ngram_gen.generate(token):
                    ngram_index[ngram].add(token)
            
            # Индекс подсказок
            name_tokens = self.query_processor.tokenize(
                self.query_processor.normalize(product.name)
            )
            for i in range(len(name_tokens)):
                prefix = " ".join(name_tokens[:i+1])
                suggest_index[prefix] += 1
        
        # Атомарная замена в Redis
        pipe = self.redis.pipeline()
        
        # Удаляем старые данные (только товары и индексы, НЕ данные проекта)
        old_product_keys = await self.redis.keys(f"products:{project_id}:*")
        old_idx_keys = await self.redis.keys(f"idx:{project_id}:*")
        old_keys = old_product_keys + old_idx_keys
        if old_keys:
            pipe.delete(*old_keys)
        
        # Сохраняем товары
        for key, value in products_data.items():
            pipe.set(key, value)
        
        # Сохраняем инвертированный индекс
        for token, product_scores in inverted_index.items():
            key = f"idx:{project_id}:inv:{token}"
            pipe.zadd(key, product_scores)
        
        # Сохраняем n-gram индекс
        for ngram, tokens in ngram_index.items():
            key = f"idx:{project_id}:ngram:{ngram}"
            if tokens:
                pipe.sadd(key, *tokens)
        
        # Сохраняем индекс подсказок
        for prefix, count in suggest_index.items():
            key = f"idx:{project_id}:suggest"
            pipe.zadd(key, {prefix: count})
        
        await pipe.execute()
        
        return len(products)
    
    def _extract_tokens(self, product: Product) -> Dict[str, float]:
        """Извлечение токенов с весами"""
        tokens_scores = {}
        
        # Название (вес 3.0)
        if product.name:
            name_query = self.query_processor.process(product.name)
            for token in name_query.tokens:
                tokens_scores[token] = tokens_scores.get(token, 0) + 3.0
        
        # Описание (вес 1.0)
        if product.description:
            desc_query = self.query_processor.process(product.description[:500])
            for token in desc_query.tokens:
                tokens_scores[token] = tokens_scores.get(token, 0) + 1.0
        
        # Бренд (вес 2.0)
        if product.brand:
            brand_query = self.query_processor.process(product.brand)
            for token in brand_query.tokens:
                tokens_scores[token] = tokens_scores.get(token, 0) + 2.0
        
        # Категория (вес 1.5)
        if product.category:
            cat_query = self.query_processor.process(product.category)
            for token in cat_query.tokens:
                tokens_scores[token] = tokens_scores.get(token, 0) + 1.5
        
        # Артикул (вес 3.0 - важно для точного поиска)
        vendor_code = getattr(product, 'vendor_code', '')
        if vendor_code:
            vc_query = self.query_processor.process(vendor_code)
            for token in vc_query.tokens:
                tokens_scores[token] = tokens_scores.get(token, 0) + 3.0
        
        # Параметры товара из фида (вес 2.0)
        params = {}
        if hasattr(product, 'params') and product.params:
            params = product.params
        elif hasattr(product, '__dict__') and 'params' in product.__dict__:
            params = product.__dict__.get('params') or {}
        
        for param_name, param_value in params.items():
            # Индексируем и название и значение параметра
            if param_value:
                param_text = f"{param_value}"
                param_query = self.query_processor.process(param_text)
                for token in param_query.tokens:
                    tokens_scores[token] = tokens_scores.get(token, 0) + 2.0
        
        return tokens_scores
    
    async def update_product_stock(
        self, 
        project_id: str, 
        product_id: str, 
        in_stock: bool, 
        price: float = None
    ) -> bool:
        """Быстрое обновление остатков/цен"""
        key = f"products:{project_id}:{product_id}"
        
        data = await self.redis.get(key)
        if not data:
            return False
        
        product_data = json.loads(data)
        product_data["in_stock"] = in_stock
        
        if price is not None:
            product_data["price"] = price
        
        await self.redis.set(key, json.dumps(product_data))
        return True
