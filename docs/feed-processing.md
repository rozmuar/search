# Обработка фидов

## Типы фидов

### 1. Полный фид (Full Feed)

Содержит всю информацию о товарах. Обновляется редко (1-24 часа).

```xml
<?xml version="1.0" encoding="UTF-8"?>
<products>
    <product>
        <id>SKU-12345</id>
        <name>Кроссовки Nike Air Max 90</name>
        <description>Легендарные кроссовки с технологией Air Max...</description>
        <url>https://shop.com/products/nike-air-max-90</url>
        <image>https://shop.com/images/nike-air-max-90.jpg</image>
        <price>12990</price>
        <old_price>15990</old_price>
        <currency>RUB</currency>
        <category>Обувь > Кроссовки > Nike</category>
        <brand>Nike</brand>
        <in_stock>true</in_stock>
        <quantity>15</quantity>
        <attributes>
            <attribute name="Цвет">Белый</attribute>
            <attribute name="Размер">42, 43, 44</attribute>
            <attribute name="Материал">Кожа, текстиль</attribute>
        </attributes>
    </product>
    <!-- ... другие товары ... -->
</products>
```

### 2. Delta-фид (остатки и цены)

Сокращённый фид только с ID, ценой и остатками. Обновляется часто (5-30 минут).

```xml
<?xml version="1.0" encoding="UTF-8"?>
<stock_update timestamp="2024-01-15T10:30:00Z">
    <item>
        <id>SKU-12345</id>
        <price>11990</price>
        <old_price>15990</old_price>
        <in_stock>true</in_stock>
        <quantity>12</quantity>
    </item>
    <item>
        <id>SKU-12346</id>
        <price>8990</price>
        <in_stock>false</in_stock>
        <quantity>0</quantity>
    </item>
    <!-- ... другие товары ... -->
</stock_update>
```

## Архитектура обработки фидов

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         FEED PROCESSING PIPELINE                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐               │
│  │   Scheduler  │───▶│  Downloader  │───▶│   Parser     │               │
│  │              │    │              │    │              │               │
│  │  • Cron      │    │  • HTTP GET  │    │  • XML       │               │
│  │  • Intervals │    │  • Retry     │    │  • JSON      │               │
│  │  • Priority  │    │  • Streaming │    │  • CSV       │               │
│  └──────────────┘    └──────────────┘    └──────────────┘               │
│                                                 │                        │
│                                                 ▼                        │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐               │
│  │   Indexer    │◀───│  Transformer │◀───│  Validator   │               │
│  │              │    │              │    │              │               │
│  │  • Full idx  │    │  • Normalize │    │  • Schema    │               │
│  │  • N-gram    │    │  • Enrich    │    │  • Required  │               │
│  │  • Suggest   │    │  • Dedupe    │    │  • Types     │               │
│  └──────────────┘    └──────────────┘    └──────────────┘               │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Алгоритм обработки полного фида

```python
class FullFeedProcessor:
    """
    Обработчик полного фида товаров
    """
    
    async def process(self, project_id: str, feed_url: str) -> ProcessResult:
        """
        Полный цикл обработки фида
        """
        start_time = time.time()
        
        try:
            # 1. Загрузка фида
            feed_content = await self.download_feed(feed_url)
            
            # 2. Определение формата и парсинг
            products = self.parse_feed(feed_content)
            
            # 3. Валидация
            valid_products, errors = self.validate_products(products)
            
            # 4. Трансформация и обогащение
            transformed = self.transform_products(valid_products)
            
            # 5. Построение индексов (атомарная замена)
            await self.rebuild_indexes(project_id, transformed)
            
            # 6. Обновление метаданных
            await self.update_feed_status(project_id, {
                'status': 'success',
                'items_count': len(transformed),
                'errors_count': len(errors),
                'duration': time.time() - start_time
            })
            
            return ProcessResult(success=True, items=len(transformed))
            
        except Exception as e:
            await self.update_feed_status(project_id, {
                'status': 'error',
                'error': str(e)
            })
            raise
    
    async def download_feed(self, url: str) -> bytes:
        """
        Загрузка фида с поддержкой больших файлов
        """
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=300) as response:
                if response.status != 200:
                    raise FeedDownloadError(f"HTTP {response.status}")
                
                # Стриминг для больших файлов
                chunks = []
                async for chunk in response.content.iter_chunked(1024 * 1024):
                    chunks.append(chunk)
                    
                    # Проверка лимита размера
                    if sum(len(c) for c in chunks) > MAX_FEED_SIZE:
                        raise FeedTooLargeError()
                
                return b''.join(chunks)
    
    def parse_feed(self, content: bytes) -> List[RawProduct]:
        """
        Парсинг фида (XML или JSON)
        """
        # Определяем формат
        if content.strip().startswith(b'<?xml') or content.strip().startswith(b'<'):
            return self.parse_xml(content)
        else:
            return self.parse_json(content)
    
    def parse_xml(self, content: bytes) -> List[RawProduct]:
        """
        Потоковый парсинг XML для экономии памяти
        """
        products = []
        
        # Используем iterparse для больших файлов
        for event, elem in ET.iterparse(io.BytesIO(content), events=['end']):
            if elem.tag == 'product' or elem.tag == 'offer':
                product = self.extract_product_from_xml(elem)
                products.append(product)
                
                # Очищаем память
                elem.clear()
        
        return products
    
    def validate_products(self, products: List[RawProduct]) -> Tuple[List, List]:
        """
        Валидация товаров
        """
        valid = []
        errors = []
        
        for product in products:
            validation_errors = []
            
            # Обязательные поля
            if not product.get('id'):
                validation_errors.append('Missing ID')
            if not product.get('name'):
                validation_errors.append('Missing name')
            if not product.get('url'):
                validation_errors.append('Missing URL')
            
            # Типы данных
            try:
                if product.get('price'):
                    float(product['price'])
            except ValueError:
                validation_errors.append('Invalid price format')
            
            if validation_errors:
                errors.append({
                    'product_id': product.get('id'),
                    'errors': validation_errors
                })
            else:
                valid.append(product)
        
        return valid, errors
    
    def transform_products(self, products: List[RawProduct]) -> List[Product]:
        """
        Трансформация и обогащение данных
        """
        transformed = []
        
        for raw in products:
            product = Product(
                id=str(raw['id']),
                name=self.normalize_text(raw['name']),
                description=self.normalize_text(raw.get('description', '')),
                url=raw['url'],
                image=raw.get('image'),
                price=float(raw.get('price', 0)),
                old_price=float(raw.get('old_price', 0)) if raw.get('old_price') else None,
                in_stock=self.parse_bool(raw.get('in_stock', True)),
                quantity=int(raw.get('quantity', 0)) if raw.get('quantity') else None,
                category=raw.get('category'),
                brand=raw.get('brand'),
                attributes=raw.get('attributes', {}),
                
                # Вычисляемые поля
                discount_percent=self.calc_discount(raw),
                search_text=self.build_search_text(raw),
                tokens=self.tokenize(raw),
            )
            transformed.append(product)
        
        return transformed
    
    def build_search_text(self, product: dict) -> str:
        """
        Построение текста для индексации
        """
        parts = [
            product.get('name', ''),
            product.get('description', ''),
            product.get('brand', ''),
            product.get('category', ''),
        ]
        
        # Добавляем атрибуты
        for attr in product.get('attributes', {}).values():
            parts.append(str(attr))
        
        return ' '.join(filter(None, parts))
    
    async def rebuild_indexes(self, project_id: str, products: List[Product]):
        """
        Атомарное перестроение индексов
        """
        # Создаём новые индексы во временных ключах
        temp_suffix = f"_tmp_{int(time.time())}"
        
        # 1. Сохраняем товары
        product_data = {}
        for product in products:
            product_data[f"products:{project_id}:{product.id}"] = product.to_json()
        
        # 2. Строим инвертированный индекс
        inverted_index = defaultdict(dict)
        for product in products:
            for token in product.tokens:
                score = self.calc_token_score(token, product)
                inverted_index[token][product.id] = score
        
        # 3. Строим n-gram индекс
        ngram_index = defaultdict(set)
        for product in products:
            for token in product.tokens:
                for ngram in self.generate_ngrams(token):
                    ngram_index[ngram].add(token)
        
        # 4. Строим Trie для подсказок
        suggestions = self.build_suggestions(products)
        
        # 5. Атомарная замена (MULTI/EXEC)
        async with self.redis.pipeline() as pipe:
            # Удаляем старые индексы
            old_keys = await self.redis.keys(f"idx:{project_id}:*")
            if old_keys:
                pipe.delete(*old_keys)
            
            # Записываем товары
            for key, value in product_data.items():
                pipe.set(key, value)
            
            # Записываем инвертированный индекс
            for token, products_scores in inverted_index.items():
                key = f"idx:{project_id}:inv:{token}"
                pipe.zadd(key, products_scores)
            
            # Записываем n-gram индекс
            for ngram, tokens in ngram_index.items():
                key = f"idx:{project_id}:ngram:{ngram}"
                pipe.sadd(key, *tokens)
            
            # Записываем подсказки
            for suggestion in suggestions:
                key = f"idx:{project_id}:suggest:{suggestion.prefix}"
                pipe.zadd(key, {suggestion.text: suggestion.score})
            
            await pipe.execute()
```

## Алгоритм обработки Delta-фида

```python
class DeltaFeedProcessor:
    """
    Обработчик delta-фида (только остатки и цены)
    Быстрый, без переиндексации
    """
    
    async def process(self, project_id: str, feed_url: str) -> ProcessResult:
        """
        Быстрое обновление остатков и цен
        """
        start_time = time.time()
        
        # 1. Загрузка фида (обычно маленький)
        feed_content = await self.download_feed(feed_url)
        
        # 2. Парсинг
        updates = self.parse_delta_feed(feed_content)
        
        # 3. Batch-обновление в Redis
        updated_count = await self.apply_updates(project_id, updates)
        
        # 4. Инвалидация кэша для изменённых товаров
        await self.invalidate_cache(project_id, updates)
        
        return ProcessResult(
            success=True,
            items=updated_count,
            duration=time.time() - start_time
        )
    
    async def apply_updates(self, project_id: str, updates: List[StockUpdate]) -> int:
        """
        Применение обновлений без переиндексации
        """
        updated = 0
        
        async with self.redis.pipeline() as pipe:
            for update in updates:
                key = f"products:{project_id}:{update.id}"
                
                # Получаем текущий товар
                current = await self.redis.get(key)
                if not current:
                    continue  # Товар не найден в индексе
                
                product = json.loads(current)
                
                # Обновляем только цену и остатки
                changed = False
                
                if update.price is not None and product['price'] != update.price:
                    product['price'] = update.price
                    changed = True
                
                if update.old_price is not None:
                    product['old_price'] = update.old_price
                    changed = True
                
                if update.in_stock is not None and product['in_stock'] != update.in_stock:
                    product['in_stock'] = update.in_stock
                    changed = True
                    
                    # Если товар закончился, понижаем его в индексе
                    if not update.in_stock:
                        await self.demote_out_of_stock(project_id, update.id)
                
                if update.quantity is not None:
                    product['quantity'] = update.quantity
                    changed = True
                
                if changed:
                    # Пересчитываем скидку
                    if product['old_price'] and product['price']:
                        product['discount_percent'] = round(
                            (1 - product['price'] / product['old_price']) * 100
                        )
                    
                    pipe.set(key, json.dumps(product))
                    updated += 1
            
            await pipe.execute()
        
        return updated
    
    async def demote_out_of_stock(self, project_id: str, product_id: str):
        """
        Понижение товара без остатков в выдаче
        """
        # Уменьшаем скор во всех индексах
        pattern = f"idx:{project_id}:inv:*"
        keys = await self.redis.keys(pattern)
        
        for key in keys:
            score = await self.redis.zscore(key, product_id)
            if score:
                # Уменьшаем скор на 50%
                await self.redis.zadd(key, {product_id: score * 0.5})
    
    async def invalidate_cache(self, project_id: str, updates: List[StockUpdate]):
        """
        Инвалидация кэша для изменённых товаров
        """
        # Получаем список запросов, где были эти товары
        product_ids = [u.id for u in updates]
        
        # Ищем в обратном индексе (товар -> запросы)
        for product_id in product_ids:
            queries_key = f"cache:queries:{project_id}:{product_id}"
            affected_queries = await self.redis.smembers(queries_key)
            
            # Удаляем кэш для каждого запроса
            for query_hash in affected_queries:
                cache_key = f"cache:{project_id}:q:{query_hash}"
                await self.redis.delete(cache_key)
```

## Scheduler (Планировщик)

```python
class FeedScheduler:
    """
    Планировщик обновления фидов
    """
    
    def __init__(self):
        self.queue = asyncio.PriorityQueue()
    
    async def run(self):
        """
        Основной цикл планировщика
        """
        while True:
            # Получаем следующую задачу
            priority, task = await self.queue.get()
            
            # Проверяем, пора ли выполнять
            if task.next_run > datetime.now():
                # Ждём до времени выполнения
                await asyncio.sleep(
                    (task.next_run - datetime.now()).total_seconds()
                )
            
            # Выполняем обновление
            await self.process_feed(task)
            
            # Планируем следующее обновление
            task.next_run = datetime.now() + task.interval
            await self.queue.put((task.priority, task))
    
    async def schedule_feed(self, feed: Feed):
        """
        Добавление фида в расписание
        """
        task = FeedTask(
            feed_id=feed.id,
            project_id=feed.project_id,
            feed_type=feed.type,
            url=feed.url,
            interval=timedelta(seconds=feed.update_interval),
            next_run=datetime.now(),
            priority=1 if feed.type == 'delta' else 2  # Delta приоритетнее
        )
        
        await self.queue.put((task.priority, task))
    
    async def process_feed(self, task: FeedTask):
        """
        Обработка фида
        """
        try:
            if task.feed_type == 'full':
                processor = FullFeedProcessor()
            else:
                processor = DeltaFeedProcessor()
            
            result = await processor.process(task.project_id, task.url)
            
            logger.info(f"Feed {task.feed_id} processed: {result.items} items")
            
        except Exception as e:
            logger.error(f"Feed {task.feed_id} failed: {e}")
            
            # Уведомление об ошибке
            await self.notify_error(task, e)
```

## Форматы фидов

### Поддерживаемые форматы

| Формат | Расширение | Описание |
|--------|------------|----------|
| YML (Yandex Market) | .xml | Стандарт Яндекс.Маркета |
| Google Merchant | .xml | Формат Google Shopping |
| JSON Feed | .json | Произвольный JSON |
| CSV | .csv | Табличный формат |

### Маппинг полей

```python
FIELD_MAPPINGS = {
    # YML формат
    'yml': {
        'id': ['@id', 'id'],
        'name': ['name', 'title'],
        'description': ['description'],
        'price': ['price'],
        'old_price': ['oldprice', 'old_price'],
        'url': ['url'],
        'image': ['picture', 'image'],
        'category': ['categoryId'],
        'in_stock': ['available', 'in_stock'],
    },
    
    # Google Merchant формат
    'google': {
        'id': ['g:id', 'id'],
        'name': ['g:title', 'title'],
        'description': ['g:description', 'description'],
        'price': ['g:price', 'price'],
        'url': ['g:link', 'link'],
        'image': ['g:image_link', 'image_link'],
        'category': ['g:product_type', 'product_type'],
        'in_stock': ['g:availability', 'availability'],
    }
}
```

## Мониторинг и алерты

```python
class FeedMonitor:
    """
    Мониторинг состояния фидов
    """
    
    async def check_feed_health(self, project_id: str):
        """
        Проверка здоровья фидов проекта
        """
        feeds = await self.get_project_feeds(project_id)
        
        for feed in feeds:
            issues = []
            
            # Проверка доступности
            if feed.last_status == 'error':
                issues.append(AlertType.FEED_UNAVAILABLE)
            
            # Проверка актуальности
            expected_update = feed.last_update + timedelta(
                seconds=feed.update_interval * 2
            )
            if datetime.now() > expected_update:
                issues.append(AlertType.FEED_STALE)
            
            # Проверка количества товаров
            if feed.items_count < feed.expected_items_count * 0.8:
                issues.append(AlertType.FEED_ITEMS_DROP)
            
            # Отправка алертов
            for issue in issues:
                await self.send_alert(project_id, feed.id, issue)
```
