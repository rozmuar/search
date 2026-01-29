"""
Индексатор товаров
"""
import json
from typing import List, Dict, Any, Set
from collections import defaultdict
from datetime import datetime

from ..core.models import Product
from ..core.interfaces import IIndexer
from .query_processor import QueryProcessor, NGramGenerator, Stemmer


class Indexer(IIndexer):
    """
    Индексатор товаров
    
    Строит и обновляет поисковые индексы:
    - Инвертированный индекс (токен -> товары со скорами)
    - N-gram индекс (для частичного совпадения)
    - Индекс подсказок (для автодополнения)
    - Индекс категорий
    """
    
    def __init__(self, redis_client, config: dict = None):
        self.redis = redis_client
        self.config = config or {}
        self.query_processor = QueryProcessor()
        self.ngram_gen = NGramGenerator(n=3)
        self.stemmer = Stemmer()
    
    async def index_products(
        self,
        project_id: str,
        products: List[Product]
    ) -> int:
        """
        Полная индексация товаров (атомарная замена)
        """
        if not products:
            return 0
        
        # 1. Подготавливаем данные для индексов
        products_data = {}
        inverted_index = defaultdict(dict)  # {token: {product_id: score}}
        ngram_index = defaultdict(set)       # {ngram: {tokens}}
        suggest_index = defaultdict(dict)    # {prefix: {query: count}}
        categories_count = defaultdict(int)
        
        for product in products:
            # Сохраняем товар
            products_data[f"products:{project_id}:{product.id}"] = self._serialize_product(product)
            
            # Получаем токены для индексации
            tokens = self._extract_tokens(product)
            
            # Строим инвертированный индекс
            for token in tokens:
                score = self._calc_token_score(token, product)
                inverted_index[token][product.id] = score
                
                # Строим n-gram индекс
                for ngram in self.ngram_gen.generate(token):
                    ngram_index[ngram].add(token)
            
            # Индекс подсказок (по названию товара)
            self._add_to_suggest_index(product.name, suggest_index)
            
            # Индекс категорий
            if product.category:
                categories_count[product.category] += 1
        
        # 2. Атомарная замена индексов в Redis
        async with self.redis.pipeline() as pipe:
            # Удаляем старые индексы проекта
            old_keys = await self.redis.keys(f"idx:{project_id}:*")
            if old_keys:
                pipe.delete(*old_keys)
            
            old_products = await self.redis.keys(f"products:{project_id}:*")
            if old_products:
                pipe.delete(*old_products)
            
            # Записываем товары
            for key, value in products_data.items():
                pipe.set(key, value)
            
            # Записываем инвертированный индекс
            for token, products_scores in inverted_index.items():
                key = f"idx:{project_id}:inv:{token}"
                # ZADD с mapping
                pipe.zadd(key, products_scores)
            
            # Записываем n-gram индекс
            for ngram, tokens in ngram_index.items():
                key = f"idx:{project_id}:ngram:{ngram}"
                pipe.sadd(key, *tokens)
            
            # Записываем индекс подсказок
            for prefix, queries in suggest_index.items():
                key = f"idx:{project_id}:suggest:{prefix}"
                pipe.zadd(key, queries)
            
            # Записываем индекс категорий
            key = f"idx:{project_id}:categories"
            for category, count in categories_count.items():
                pipe.hset(key, category, count)
            
            # Сохраняем метаданные индекса
            meta_key = f"idx:{project_id}:meta"
            pipe.hset(meta_key, mapping={
                "products_count": len(products),
                "indexed_at": datetime.now().isoformat(),
                "tokens_count": len(inverted_index),
            })
            
            await pipe.execute()
        
        return len(products)
    
    async def update_products(
        self,
        project_id: str,
        products: List[Product]
    ) -> int:
        """
        Частичное обновление товаров
        """
        updated = 0
        
        for product in products:
            # Удаляем старую версию из индекса
            await self._remove_from_index(project_id, product.id)
            
            # Добавляем новую версию
            await self._add_to_index(project_id, product)
            updated += 1
        
        return updated
    
    async def update_stock_prices(
        self,
        project_id: str,
        updates: List[Dict[str, Any]]
    ) -> int:
        """
        Быстрое обновление остатков и цен (без переиндексации)
        """
        updated = 0
        
        async with self.redis.pipeline() as pipe:
            for update in updates:
                product_id = update.get("id")
                if not product_id:
                    continue
                
                key = f"products:{project_id}:{product_id}"
                
                # Получаем текущий товар
                current_data = await self.redis.get(key)
                if not current_data:
                    continue
                
                product_dict = json.loads(current_data)
                
                # Обновляем поля
                changed = False
                
                if "price" in update and update["price"] != product_dict.get("price"):
                    product_dict["price"] = update["price"]
                    changed = True
                
                if "old_price" in update:
                    product_dict["old_price"] = update["old_price"]
                    changed = True
                
                if "in_stock" in update and update["in_stock"] != product_dict.get("in_stock"):
                    product_dict["in_stock"] = update["in_stock"]
                    changed = True
                    
                    # Если товар закончился, понижаем скор в индексе
                    if not update["in_stock"]:
                        await self._demote_product(project_id, product_id, pipe)
                    else:
                        # Если появился в наличии, восстанавливаем скор
                        await self._restore_product_score(project_id, product_id, pipe)
                
                if "quantity" in update:
                    product_dict["quantity"] = update["quantity"]
                    changed = True
                
                if changed:
                    # Пересчитываем скидку
                    if product_dict.get("old_price") and product_dict.get("price"):
                        old_price = product_dict["old_price"]
                        price = product_dict["price"]
                        if old_price > price:
                            product_dict["discount_percent"] = round((1 - price / old_price) * 100)
                        else:
                            product_dict["discount_percent"] = None
                    
                    pipe.set(key, json.dumps(product_dict))
                    updated += 1
            
            await pipe.execute()
        
        return updated
    
    async def delete_products(
        self,
        project_id: str,
        product_ids: List[str]
    ) -> int:
        """
        Удаление товаров из индекса
        """
        deleted = 0
        
        for product_id in product_ids:
            await self._remove_from_index(project_id, product_id)
            deleted += 1
        
        return deleted
    
    async def clear_index(self, project_id: str) -> None:
        """
        Очистка всего индекса проекта
        """
        # Удаляем все ключи проекта
        patterns = [
            f"idx:{project_id}:*",
            f"products:{project_id}:*",
            f"cache:{project_id}:*",
        ]
        
        for pattern in patterns:
            keys = await self.redis.keys(pattern)
            if keys:
                await self.redis.delete(*keys)
    
    # ==================== Приватные методы ====================
    
    def _serialize_product(self, product: Product) -> str:
        """Сериализация товара в JSON"""
        return json.dumps({
            "id": product.id,
            "name": product.name,
            "description": product.description,
            "url": product.url,
            "image": product.image,
            "images": product.images,
            "price": product.price,
            "old_price": product.old_price,
            "currency": product.currency,
            "in_stock": product.in_stock,
            "quantity": product.quantity,
            "category": product.category,
            "categories": product.categories,
            "brand": product.brand,
            "attributes": product.attributes,
            "discount_percent": product.discount_percent,
            "popularity": product.popularity,
        }, ensure_ascii=False)
    
    def _extract_tokens(self, product: Product) -> Set[str]:
        """
        Извлечение токенов из товара для индексации
        """
        tokens = set()
        
        # Название (высокий вес)
        name_tokens = self.query_processor.tokenize(
            self.query_processor.normalize(product.name)
        )
        tokens.update(name_tokens)
        
        # Стеммированные токены названия
        tokens.update(self.stemmer.stem_tokens(name_tokens))
        
        # Описание (средний вес)
        if product.description:
            desc_tokens = self.query_processor.tokenize(
                self.query_processor.normalize(product.description)
            )
            tokens.update(desc_tokens[:50])  # Ограничиваем
        
        # Бренд
        if product.brand:
            brand_tokens = self.query_processor.tokenize(
                self.query_processor.normalize(product.brand)
            )
            tokens.update(brand_tokens)
        
        # Категория
        if product.category:
            cat_tokens = self.query_processor.tokenize(
                self.query_processor.normalize(product.category)
            )
            tokens.update(cat_tokens)
        
        # Атрибуты
        for value in product.attributes.values():
            if isinstance(value, str):
                attr_tokens = self.query_processor.tokenize(
                    self.query_processor.normalize(value)
                )
                tokens.update(attr_tokens[:10])
        
        return tokens
    
    def _calc_token_score(self, token: str, product: Product) -> float:
        """
        Расчёт веса токена для товара
        
        Учитываем:
        - Позицию (в названии важнее)
        - Частоту
        - Наличие товара
        """
        score = 0.0
        name_lower = product.name.lower()
        
        # Токен в названии - высокий вес
        if token in name_lower:
            # Бонус за позицию в начале
            pos = name_lower.find(token)
            position_bonus = 1.0 - (pos / len(name_lower)) * 0.5
            score += 1.0 * position_bonus
        
        # Токен в бренде
        if product.brand and token in product.brand.lower():
            score += 0.5
        
        # Токен в категории
        if product.category and token in product.category.lower():
            score += 0.3
        
        # Токен в описании
        if product.description and token in product.description.lower():
            score += 0.2
        
        # Буст для товаров в наличии
        if product.in_stock:
            score *= 1.0
        else:
            score *= 0.5
        
        return round(score, 4)
    
    def _add_to_suggest_index(
        self, 
        text: str, 
        suggest_index: Dict[str, Dict[str, int]]
    ) -> None:
        """
        Добавление текста в индекс подсказок
        """
        normalized = self.query_processor.normalize(text)
        words = normalized.split()
        
        # Добавляем каждое слово и комбинации
        for i in range(len(words)):
            phrase = " ".join(words[:i + 1])
            if len(phrase) >= 2:
                prefix = phrase[:3]  # Первые 3 символа как ключ
                suggest_index[prefix][phrase] = suggest_index[prefix].get(phrase, 0) + 1
    
    async def _add_to_index(self, project_id: str, product: Product) -> None:
        """
        Добавление одного товара в индекс
        """
        tokens = self._extract_tokens(product)
        
        async with self.redis.pipeline() as pipe:
            # Сохраняем товар
            key = f"products:{project_id}:{product.id}"
            pipe.set(key, self._serialize_product(product))
            
            # Добавляем в инвертированный индекс
            for token in tokens:
                score = self._calc_token_score(token, product)
                inv_key = f"idx:{project_id}:inv:{token}"
                pipe.zadd(inv_key, {product.id: score})
                
                # Добавляем в n-gram индекс
                for ngram in self.ngram_gen.generate(token):
                    ngram_key = f"idx:{project_id}:ngram:{ngram}"
                    pipe.sadd(ngram_key, token)
            
            await pipe.execute()
    
    async def _remove_from_index(self, project_id: str, product_id: str) -> None:
        """
        Удаление товара из индекса
        """
        # Получаем товар
        key = f"products:{project_id}:{product_id}"
        data = await self.redis.get(key)
        
        if not data:
            return
        
        product_dict = json.loads(data)
        product = Product(**product_dict)
        tokens = self._extract_tokens(product)
        
        async with self.redis.pipeline() as pipe:
            # Удаляем товар
            pipe.delete(key)
            
            # Удаляем из инвертированного индекса
            for token in tokens:
                inv_key = f"idx:{project_id}:inv:{token}"
                pipe.zrem(inv_key, product_id)
            
            await pipe.execute()
    
    async def _demote_product(
        self, 
        project_id: str, 
        product_id: str, 
        pipe
    ) -> None:
        """
        Понижение товара без остатка в индексе
        """
        # Получаем все индексные ключи
        pattern = f"idx:{project_id}:inv:*"
        keys = await self.redis.keys(pattern)
        
        for key in keys:
            score = await self.redis.zscore(key, product_id)
            if score:
                # Понижаем скор на 50%
                pipe.zadd(key, {product_id: score * 0.5})
    
    async def _restore_product_score(
        self, 
        project_id: str, 
        product_id: str, 
        pipe
    ) -> None:
        """
        Восстановление скора товара при появлении в наличии
        """
        # Получаем товар и пересчитываем скоры
        key = f"products:{project_id}:{product_id}"
        data = await self.redis.get(key)
        
        if not data:
            return
        
        product_dict = json.loads(data)
        product = Product(**product_dict)
        tokens = self._extract_tokens(product)
        
        for token in tokens:
            score = self._calc_token_score(token, product)
            inv_key = f"idx:{project_id}:inv:{token}"
            pipe.zadd(inv_key, {product_id: score})
