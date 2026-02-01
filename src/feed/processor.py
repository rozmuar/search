"""
Обработчик фидов товаров
"""
import aiohttp
import xml.etree.ElementTree as ET
import json
import io
from typing import List, Dict, Any, Tuple, Optional
from datetime import datetime
from dataclasses import dataclass

from ..core.models import Feed, FeedLog, Product, FeedType, FeedFormat, FeedStatus
from ..core.interfaces import IFeedProcessor, IIndexer


@dataclass
class StockUpdate:
    """Обновление остатков/цен"""
    id: str
    price: Optional[float] = None
    old_price: Optional[float] = None
    in_stock: Optional[bool] = None
    quantity: Optional[int] = None


class FeedProcessor(IFeedProcessor):
    """
    Обработчик фидов
    
    Поддерживает:
    - YML (Yandex Market Language)
    - Google Merchant XML
    - Произвольный JSON
    - CSV
    """
    
    # Маппинг полей для разных форматов
    FIELD_MAPPINGS = {
        "yml": {
            "id": ["@id", "id"],
            "name": ["name", "title"],
            "description": ["description"],
            "price": ["price"],
            "old_price": ["oldprice", "old_price"],
            "url": ["url"],
            "image": ["picture", "image"],
            "category": ["categoryId", "category"],
            "brand": ["vendor", "brand"],
            "in_stock": ["available", "in_stock"],
            "quantity": ["quantity", "stock_quantity"],
        },
        "google": {
            "id": ["g:id", "id"],
            "name": ["g:title", "title"],
            "description": ["g:description", "description"],
            "price": ["g:price", "price"],
            "url": ["g:link", "link"],
            "image": ["g:image_link", "image_link"],
            "category": ["g:product_type", "product_type"],
            "brand": ["g:brand", "brand"],
            "in_stock": ["g:availability", "availability"],
        }
    }
    
    def __init__(
        self, 
        indexer: IIndexer,
        config: dict = None
    ):
        self.indexer = indexer
        self.config = config or {}
        self.max_feed_size = self.config.get("max_feed_size", 500 * 1024 * 1024)  # 500MB
        self.download_timeout = self.config.get("download_timeout", 300)
    
    async def process_full_feed(self, feed: Feed) -> FeedLog:
        """
        Обработка полного фида
        
        1. Загрузка
        2. Парсинг
        3. Валидация
        4. Полная переиндексация
        """
        import time
        start_time = time.time()
        
        log = FeedLog(
            id=self._generate_id(),
            feed_id=feed.id,
            status=FeedStatus.PROCESSING
        )
        
        try:
            # 1. Загрузка
            content = await self.download_feed(feed.url)
            
            # 2. Парсинг
            raw_products = self.parse_feed(content, feed.format.value)
            log.items_processed = len(raw_products)
            
            # 3. Валидация
            valid_products, errors = self.validate_products(raw_products)
            log.errors_count = len(errors)
            
            # 4. Трансформация
            products = self._transform_products(valid_products)
            
            # 5. Индексация
            indexed = await self.indexer.index_products(feed.project_id, products)
            log.items_added = indexed
            
            # Успех
            log.status = FeedStatus.SUCCESS
            log.duration_ms = int((time.time() - start_time) * 1000)
            
        except Exception as e:
            log.status = FeedStatus.ERROR
            log.error_message = str(e)
            log.duration_ms = int((time.time() - start_time) * 1000)
        
        return log
    
    async def process_delta_feed(self, feed: Feed) -> FeedLog:
        """
        Обработка delta-фида (только остатки и цены)
        
        Быстрое обновление без переиндексации
        """
        import time
        start_time = time.time()
        
        log = FeedLog(
            id=self._generate_id(),
            feed_id=feed.id,
            status=FeedStatus.PROCESSING
        )
        
        try:
            # 1. Загрузка
            content = await self.download_feed(feed.url)
            
            # 2. Парсинг delta-фида
            updates = self._parse_delta_feed(content, feed.format.value)
            log.items_processed = len(updates)
            
            # 3. Применение обновлений
            updated = await self.indexer.update_stock_prices(
                feed.project_id,
                [u.__dict__ for u in updates]
            )
            log.items_updated = updated
            
            # Успех
            log.status = FeedStatus.SUCCESS
            log.duration_ms = int((time.time() - start_time) * 1000)
            
        except Exception as e:
            log.status = FeedStatus.ERROR
            log.error_message = str(e)
            log.duration_ms = int((time.time() - start_time) * 1000)
        
        return log
    
    async def download_feed(self, url: str) -> bytes:
        """
        Загрузка фида с поддержкой больших файлов
        """
        timeout = aiohttp.ClientTimeout(total=self.download_timeout)
        
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url) as response:
                if response.status != 200:
                    raise FeedDownloadError(
                        f"Failed to download feed: HTTP {response.status}"
                    )
                
                # Проверяем размер
                content_length = response.headers.get("Content-Length")
                if content_length and int(content_length) > self.max_feed_size:
                    raise FeedTooLargeError(
                        f"Feed too large: {content_length} bytes"
                    )
                
                # Стриминг загрузки
                chunks = []
                total_size = 0
                
                async for chunk in response.content.iter_chunked(1024 * 1024):
                    chunks.append(chunk)
                    total_size += len(chunk)
                    
                    if total_size > self.max_feed_size:
                        raise FeedTooLargeError(
                            f"Feed too large: {total_size} bytes"
                        )
                
                return b"".join(chunks)
    
    def parse_feed(
        self,
        content: bytes,
        format: str
    ) -> List[Dict[str, Any]]:
        """
        Парсинг фида в зависимости от формата
        """
        # Определяем формат по содержимому, если не указан
        content_start = content[:100].strip()
        
        if format == "xml" or content_start.startswith(b"<?xml") or content_start.startswith(b"<"):
            return self._parse_xml_feed(content)
        elif format == "json" or content_start.startswith(b"{") or content_start.startswith(b"["):
            return self._parse_json_feed(content)
        elif format == "csv":
            return self._parse_csv_feed(content)
        else:
            # Пробуем XML по умолчанию
            return self._parse_xml_feed(content)
    
    def _parse_xml_feed(self, content: bytes) -> List[Dict[str, Any]]:
        """
        Парсинг XML фида (YML или Google Merchant)
        """
        products = []
        
        # Определяем тип фида
        is_yml = b"<yml_catalog" in content or b"<offer" in content
        field_mapping = self.FIELD_MAPPINGS["yml" if is_yml else "google"]
        
        # Потоковый парсинг для экономии памяти
        for event, elem in ET.iterparse(io.BytesIO(content), events=["end"]):
            tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
            
            if tag in ("offer", "item", "product", "entry"):
                product = self._extract_product_from_xml(elem, field_mapping)
                if product:
                    products.append(product)
                
                # Очищаем память
                elem.clear()
        
        return products
    
    def _extract_product_from_xml(
        self, 
        elem: ET.Element, 
        field_mapping: Dict
    ) -> Optional[Dict[str, Any]]:
        """
        Извлечение данных товара из XML элемента
        """
        product = {}
        
        # ID из атрибута или вложенного элемента
        product["id"] = elem.get("id")
        if not product["id"]:
            id_elem = elem.find("id")
            if id_elem is not None:
                product["id"] = id_elem.text
        
        if not product["id"]:
            return None
        
        # Остальные поля
        for field, possible_tags in field_mapping.items():
            if field == "id":
                continue
            
            for tag in possible_tags:
                if tag.startswith("@"):
                    # Атрибут
                    value = elem.get(tag[1:])
                else:
                    # Вложенный элемент
                    child = elem.find(tag)
                    if child is None:
                        # Пробуем с namespace
                        for ns_child in elem:
                            child_tag = ns_child.tag.split("}")[-1] if "}" in ns_child.tag else ns_child.tag
                            if child_tag == tag:
                                child = ns_child
                                break
                    
                    value = child.text if child is not None else None
                
                if value:
                    product[field] = value
                    break
        
        # Дополнительные изображения
        pictures = elem.findall("picture")
        if len(pictures) > 1:
            product["images"] = [p.text for p in pictures if p.text]
        
        # Атрибуты (param в YML)
        params = elem.findall("param")
        if params:
            product["attributes"] = {}
            for param in params:
                name = param.get("name")
                if name and param.text:
                    product["attributes"][name] = param.text
        
        return product
    
    def _parse_json_feed(self, content: bytes) -> List[Dict[str, Any]]:
        """
        Парсинг JSON фида
        """
        data = json.loads(content)
        
        # Ищем массив товаров
        if isinstance(data, list):
            return data
        elif isinstance(data, dict):
            # Ищем в известных ключах
            for key in ["products", "items", "offers", "data"]:
                if key in data and isinstance(data[key], list):
                    return data[key]
        
        return []
    
    def _parse_csv_feed(self, content: bytes) -> List[Dict[str, Any]]:
        """
        Парсинг CSV фида
        """
        import csv
        
        # Определяем кодировку
        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError:
            text = content.decode("cp1251")
        
        reader = csv.DictReader(io.StringIO(text))
        return list(reader)
    
    def _parse_delta_feed(
        self, 
        content: bytes, 
        format: str
    ) -> List[StockUpdate]:
        """
        Парсинг delta-фида (остатки и цены)
        """
        updates = []
        
        if format in ("xml", "yml"):
            for event, elem in ET.iterparse(io.BytesIO(content), events=["end"]):
                tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
                
                if tag in ("item", "offer", "product"):
                    update = StockUpdate(id=elem.get("id") or elem.findtext("id"))
                    
                    if not update.id:
                        elem.clear()
                        continue
                    
                    # Цена
                    price_elem = elem.find("price")
                    if price_elem is not None and price_elem.text:
                        try:
                            update.price = float(price_elem.text.replace(",", ".").replace(" ", ""))
                        except ValueError:
                            pass
                    
                    # Старая цена
                    old_price_elem = elem.find("oldprice") or elem.find("old_price")
                    if old_price_elem is not None and old_price_elem.text:
                        try:
                            update.old_price = float(old_price_elem.text.replace(",", ".").replace(" ", ""))
                        except ValueError:
                            pass
                    
                    # Наличие
                    available = elem.get("available") or elem.findtext("available") or elem.findtext("in_stock")
                    if available:
                        update.in_stock = available.lower() in ("true", "1", "yes", "в наличии")
                    
                    # Количество
                    quantity_elem = elem.find("quantity") or elem.find("stock_quantity")
                    if quantity_elem is not None and quantity_elem.text:
                        try:
                            update.quantity = int(quantity_elem.text)
                        except ValueError:
                            pass
                    
                    updates.append(update)
                    elem.clear()
        
        elif format == "json":
            data = json.loads(content)
            items = data if isinstance(data, list) else data.get("items", data.get("products", []))
            
            for item in items:
                update = StockUpdate(
                    id=str(item.get("id")),
                    price=item.get("price"),
                    old_price=item.get("old_price") or item.get("oldprice"),
                    in_stock=item.get("in_stock") or item.get("available"),
                    quantity=item.get("quantity")
                )
                if update.id:
                    updates.append(update)
        
        return updates
    
    def validate_products(
        self,
        products: List[Dict]
    ) -> Tuple[List[Dict], List[Dict]]:
        """
        Валидация товаров
        """
        valid = []
        errors = []
        
        for product in products:
            validation_errors = []
            
            # Обязательные поля
            if not product.get("id"):
                validation_errors.append("Missing ID")
            if not product.get("name"):
                validation_errors.append("Missing name")
            if not product.get("url"):
                validation_errors.append("Missing URL")
            
            # Валидация типов
            if product.get("price"):
                try:
                    price = product["price"]
                    if isinstance(price, str):
                        price = price.replace(",", ".").replace(" ", "")
                    float(price)
                except (ValueError, TypeError):
                    validation_errors.append("Invalid price format")
            
            if validation_errors:
                errors.append({
                    "product_id": product.get("id"),
                    "errors": validation_errors
                })
            else:
                valid.append(product)
        
        return valid, errors
    
    def _transform_products(self, raw_products: List[Dict]) -> List[Product]:
        """
        Трансформация сырых данных в объекты Product
        """
        products = []
        
        for raw in raw_products:
            try:
                # Парсим цены
                price = self._parse_price(raw.get("price", 0))
                old_price = self._parse_price(raw.get("old_price")) if raw.get("old_price") else None
                
                # Парсим наличие
                in_stock = self._parse_bool(raw.get("in_stock", True))
                
                product = Product(
                    id=str(raw["id"]),
                    name=self._clean_text(raw["name"]),
                    description=self._clean_text(raw.get("description", "")),
                    url=raw["url"],
                    image=raw.get("image"),
                    images=raw.get("images", []),
                    price=price,
                    old_price=old_price,
                    in_stock=in_stock,
                    quantity=int(raw["quantity"]) if raw.get("quantity") else None,
                    category=raw.get("category"),
                    brand=raw.get("brand"),
                    vendor_code=raw.get("vendor_code"),
                    params=raw.get("params", {}),
                    attributes=raw.get("attributes", {}),
                )
                
                products.append(product)
                
            except Exception as e:
                # Логируем ошибку, но продолжаем
                print(f"Error transforming product {raw.get('id')}: {e}")
        
        return products
    
    def _parse_price(self, value) -> float:
        """Парсинг цены"""
        if value is None:
            return 0.0
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            # Убираем валюту и пробелы
            cleaned = value.replace(",", ".").replace(" ", "")
            cleaned = "".join(c for c in cleaned if c.isdigit() or c == ".")
            return float(cleaned) if cleaned else 0.0
        return 0.0
    
    def _parse_bool(self, value) -> bool:
        """Парсинг булевого значения"""
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.lower() in ("true", "1", "yes", "в наличии", "available")
        return bool(value)
    
    def _clean_text(self, text: str) -> str:
        """Очистка текста"""
        if not text:
            return ""
        # Удаляем HTML теги
        import re
        text = re.sub(r"<[^>]+>", "", text)
        # Удаляем множественные пробелы
        text = " ".join(text.split())
        return text.strip()
    
    def _generate_id(self) -> str:
        """Генерация уникального ID"""
        import uuid
        return str(uuid.uuid4())


class FeedDownloadError(Exception):
    """Ошибка загрузки фида"""
    pass


class FeedTooLargeError(Exception):
    """Фид слишком большой"""
    pass


class FeedParseError(Exception):
    """Ошибка парсинга фида"""
    pass
