"""
Упрощенный индексатор без ML
"""
import asyncio
import json
import logging
from typing import List, Dict, Any, Set
from collections import defaultdict

from ..core.models import Product

logger = logging.getLogger(__name__)


async def _scan_keys(client, pattern: str) -> list:
    """Неблокирующий аналог KEYS - не держит event loop и Redis на больших keyspace"""
    keys = []
    async for key in client.scan_iter(match=pattern, count=500):
        keys.append(key)
    return keys


class SimpleIndexer:
    """
    Базовый индексатор товаров
    
    Строит:
    - Инвертированный индекс (токен -> товары со скорами)
    - N-gram индекс (для частичного совпадения)
    - Индекс подсказок (для автодополнения)
    """
    
    BATCH_SIZE = 2000  # команд на один pipeline.execute() - см. index_products

    def __init__(self, redis_client, query_processor, ngram_gen, db=None):
        self.redis = redis_client
        self.query_processor = query_processor
        self.ngram_gen = ngram_gen
        self.db = db  # PostgreSQL для бэкапа

    MEMBER_CHUNK = 500  # аргументов на одну SADD/ZADD-команду - см. index_products

    async def _write_in_batches(self, items, apply_fn):
        """Пишет items в Redis пачками по BATCH_SIZE команд, вместо одного
        гигантского pipeline на всю коллекцию. apply_fn(pipe, item) сама решает,
        какую команду добавить (SET/ZADD/SADD - структура отличается по вызову).

        apply_fn отвечает за ОДНУ команду - если у одного ключа (частая n-грамма
        от числовых артикулов/id, общеупотребимое слово) может быть до десятков
        тысяч членов, apply_fn обязана сама резать их на куски по MEMBER_CHUNK
        через несколько вызовов pipe.<cmd>(...) - иначе ОДНА такая команда сама
        по себе надолго займёт Redis, независимо от чанкования по числу команд."""
        pipe = self.redis.pipeline()
        pending = 0
        for item in items:
            pending += apply_fn(pipe, item)
            if pending >= self.BATCH_SIZE:
                await pipe.execute()
                pipe = self.redis.pipeline()
                pending = 0
        if pending:
            await pipe.execute()

    async def index_products(self, project_id: str, products: List[Product]) -> int:
        """Полная индексация товаров"""
        if not products:
            return 0

        # Токенизация и построение индексов - CPU-bound, выносим в отдельный
        # поток чтобы не блокировать event loop на время обработки большого
        # каталога (иначе сервер перестаёт отвечать на другие запросы)
        products_data, inverted_index, ngram_index, suggest_index = await asyncio.to_thread(
            self._build_index_data, project_id, products
        )

        # Удаляем старые данные (только товары и индексы, НЕ данные проекта) - чанками,
        # не одним DEL на десятки тысяч ключей разом
        old_product_keys = await _scan_keys(self.redis, f"products:{project_id}:*")
        old_idx_keys = await _scan_keys(self.redis, f"idx:{project_id}:*")
        old_keys = old_product_keys + old_idx_keys
        for i in range(0, len(old_keys), self.BATCH_SIZE):
            batch = old_keys[i:i + self.BATCH_SIZE]
            if batch:
                await self.redis.delete(*batch)

        # Запись новых индексов - чанками по BATCH_SIZE команд на pipeline.execute(),
        # а не одним гигантским pipeline на весь каталог. Redis выполняет команды
        # однопоточно: один pipeline на сотни тысяч команд (обычное дело для
        # каталога в десятки тысяч товаров - там ещё инвертированный индекс,
        # n-граммы и подсказки) надолго занимает Redis целиком, и поиск
        # перестаёт отвечать сразу у ВСЕХ проектов на этом Redis, пока идёт
        # загрузка одного большого фида. Чанками Redis успевает обслуживать
        # остальных клиентов между батчами.
        def _set_one(pipe, kv):
            pipe.set(kv[0], kv[1])
            return 1

        def _zadd_inverted(pipe, kv):
            """ZADD инвертированного индекса - для очень частых слов (встречаются
            в большинстве товаров каталога) mapping может разрастись до десятков
            тысяч product_id -> режем на несколько ZADD с тем же ключом."""
            token, scores = kv
            key = f"idx:{project_id}:inv:{token}"
            items_list = list(scores.items())
            if len(items_list) <= self.MEMBER_CHUNK:
                pipe.zadd(key, scores)
                return 1
            n = 0
            for i in range(0, len(items_list), self.MEMBER_CHUNK):
                pipe.zadd(key, dict(items_list[i:i + self.MEMBER_CHUNK]))
                n += 1
            return n

        def _sadd_ngram(pipe, kv):
            """SADD n-граммы - короткие n-граммы из числовых артикулов/id могут
            собрать множество из десятков тысяч токенов -> режем на несколько SADD."""
            ngram, tokens = kv
            key = f"idx:{project_id}:ngram:{ngram}"
            tokens_list = list(tokens)
            n = 0
            for i in range(0, len(tokens_list), self.MEMBER_CHUNK):
                pipe.sadd(key, *tokens_list[i:i + self.MEMBER_CHUNK])
                n += 1
            return n

        def _zadd_suggest(pipe, kv):
            pipe.zadd(f"idx:{project_id}:suggest", {kv[0]: kv[1]})
            return 1

        await self._write_in_batches(products_data.items(), _set_one)
        await self._write_in_batches(inverted_index.items(), _zadd_inverted)
        await self._write_in_batches(
            (kv for kv in ngram_index.items() if kv[1]), _sadd_ngram
        )
        await self._write_in_batches(suggest_index.items(), _zadd_suggest)

        # Сбрасываем кэш категорий (см. GET /api/v1/categories) - иначе
        # свежезагруженный фид до 5 минут не отразится в scope-дропдауне виджета
        await self.redis.delete(f"cache:categories:{project_id}")

        # Бэкап в PostgreSQL
        if self.db:
            try:
                products_list = [json.loads(v) for v in products_data.values()]
                await self.db.save_products_backup(project_id, products_list)
                logger.info(f"[Indexer] Backed up {len(products_list)} products to PostgreSQL")
            except Exception as e:
                logger.error(f"[Indexer] Failed to backup to PostgreSQL: {e}")
        
        return len(products)

    def _build_index_data(self, project_id: str, products: List[Product]):
        """CPU-bound построение индексов в памяти (вызывается через to_thread)"""
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
                "category_id": getattr(product, 'category_id', None),
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

        return products_data, inverted_index, ngram_index, suggest_index

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
    
    async def restore_from_backup(self, project_id: str) -> int:
        """Восстановление индекса из PostgreSQL"""
        if not self.db:
            logger.warning("[Indexer] No database configured for restore")
            return 0
        
        try:
            # Получаем товары из PostgreSQL
            products_data = await self.db.get_products_backup(project_id)
            
            if not products_data:
                logger.info(f"[Indexer] No backup found for project {project_id}")
                return 0
            
            logger.info(f"[Indexer] Restoring {len(products_data)} products from PostgreSQL")
            
            # Конвертируем обратно в Product объекты
            products = []
            for data in products_data:
                product = Product(
                    id=data.get('id', ''),
                    name=data.get('name', ''),
                    description=data.get('description', ''),
                    url=data.get('url', ''),
                    image=data.get('image', ''),
                    price=data.get('price'),
                    old_price=data.get('old_price'),
                    in_stock=data.get('in_stock', True),
                    category=data.get('category', ''),
                    brand=data.get('brand', ''),
                )
                # Добавляем params отдельно
                if data.get('params'):
                    product.params = data['params']
                if data.get('vendor_code'):
                    product.vendor_code = data['vendor_code']
                products.append(product)
            
            # Переиндексируем (без повторного бэкапа)
            old_db = self.db
            self.db = None  # Временно отключаем бэкап
            result = await self.index_products(project_id, products)
            self.db = old_db
            
            logger.info(f"[Indexer] Restored {result} products for project {project_id}")
            return result
            
        except Exception as e:
            logger.error(f"[Indexer] Failed to restore from backup: {e}")
            return 0

    def _build_index_only(self, products: List[Product]):
        """CPU-bound построение только индекса, без товаров (вызывается через to_thread)"""
        inverted_index = defaultdict(dict)
        ngram_index = defaultdict(set)
        suggest_index = defaultdict(int)

        for product in products:
            tokens = self._extract_tokens(product)

            for token, score in tokens.items():
                inverted_index[token][product.id] = score
                for ngram in self.ngram_gen.generate(token):
                    ngram_index[ngram].add(token)

            name_tokens = self.query_processor.tokenize(
                self.query_processor.normalize(product.name)
            )
            for i in range(len(name_tokens)):
                prefix = " ".join(name_tokens[:i+1])
                suggest_index[prefix] += 1

        return inverted_index, ngram_index, suggest_index

    async def rebuild_index_from_redis(self, project_id: str) -> int:
        """Перестроение индекса из товаров в Redis (без обращения к PostgreSQL)"""
        try:
            # Получаем все товары из Redis
            product_keys = await _scan_keys(self.redis, f"products:{project_id}:*")

            if not product_keys:
                logger.warning(f"[Indexer] No products in Redis for project {project_id}")
                return 0
            
            logger.info(f"[Indexer] Rebuilding index from {len(product_keys)} products in Redis")
            
            # Загружаем данные товаров
            products = []
            for key in product_keys:
                data = await self.redis.get(key)
                if data:
                    if isinstance(data, bytes):
                        data = data.decode('utf-8')
                    product_data = json.loads(data)
                    
                    product = Product(
                        id=product_data.get('id', ''),
                        name=product_data.get('name', ''),
                        description=product_data.get('description', ''),
                        url=product_data.get('url', ''),
                        image=product_data.get('image', ''),
                        price=product_data.get('price'),
                        old_price=product_data.get('old_price'),
                        in_stock=product_data.get('in_stock', True),
                        category=product_data.get('category', ''),
                        brand=product_data.get('brand', ''),
                    )
                    if product_data.get('params'):
                        product.params = product_data['params']
                    if product_data.get('vendor_code'):
                        product.vendor_code = product_data['vendor_code']
                    products.append(product)
            
            if not products:
                return 0

            # Строим только индекс (без перезаписи товаров) - CPU-bound, в отдельном потоке
            inverted_index, ngram_index, suggest_index = await asyncio.to_thread(
                self._build_index_only, products
            )

            # Удаляем старые индексы и записываем новые - чанками (см. index_products,
            # тот же риск надолго занять Redis одним гигантским pipeline/командой)
            old_idx_keys = await _scan_keys(self.redis, f"idx:{project_id}:*")
            for i in range(0, len(old_idx_keys), self.BATCH_SIZE):
                batch = old_idx_keys[i:i + self.BATCH_SIZE]
                if batch:
                    await self.redis.delete(*batch)

            def _zadd_inverted(pipe, kv):
                token, scores = kv
                key = f"idx:{project_id}:inv:{token}"
                items_list = list(scores.items())
                if len(items_list) <= self.MEMBER_CHUNK:
                    pipe.zadd(key, scores)
                    return 1
                n = 0
                for i in range(0, len(items_list), self.MEMBER_CHUNK):
                    pipe.zadd(key, dict(items_list[i:i + self.MEMBER_CHUNK]))
                    n += 1
                return n

            def _sadd_ngram(pipe, kv):
                ngram, tokens = kv
                key = f"idx:{project_id}:ngram:{ngram}"
                tokens_list = list(tokens)
                n = 0
                for i in range(0, len(tokens_list), self.MEMBER_CHUNK):
                    pipe.sadd(key, *tokens_list[i:i + self.MEMBER_CHUNK])
                    n += 1
                return n

            def _zadd_suggest(pipe, kv):
                pipe.zadd(f"idx:{project_id}:suggest", {kv[0]: kv[1]})
                return 1

            await self._write_in_batches(inverted_index.items(), _zadd_inverted)
            await self._write_in_batches(
                (kv for kv in ngram_index.items() if kv[1]), _sadd_ngram
            )
            await self._write_in_batches(suggest_index.items(), _zadd_suggest)

            logger.info(f"[Indexer] Rebuilt index for {len(products)} products")
            return len(products)
            
        except Exception as e:
            logger.error(f"[Indexer] Failed to rebuild index: {e}")
            return 0
