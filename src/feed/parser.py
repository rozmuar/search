"""
Парсер XML фидов товаров (YML формат - Яндекс.Маркет)
Поддерживает фиды типа lm-shop.ru/feed_search.xml
"""
import xml.etree.ElementTree as ET
from typing import List, Dict, Any, Optional
import aiohttp
import asyncio
from datetime import datetime


class FeedParser:
    """Парсер XML фидов товаров"""
    
    @staticmethod
    async def fetch_feed(url: str, timeout: int = 300) -> str:
        """Загрузка фида по URL (таймаут 5 минут для больших фидов)"""
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=timeout)) as response:
                if response.status != 200:
                    raise Exception(f"Failed to fetch feed: HTTP {response.status}")
                return await response.text()
    
    @staticmethod
    def parse_yml(xml_content: str) -> Dict[str, Any]:
        """
        Парсинг YML (Яндекс.Маркет) фида
        Возвращает dict с информацией о магазине и списком товаров
        """
        root = ET.fromstring(xml_content)
        
        result = {
            "shop": {},
            "categories": {},
            "products": []
        }
        
        # Информация о магазине
        shop = root.find(".//shop")
        if shop is not None:
            result["shop"] = {
                "name": shop.findtext("name", ""),
                "company": shop.findtext("company", ""),
                "url": shop.findtext("url", ""),
            }
        
        # Категории
        categories = root.findall(".//category")
        for cat in categories:
            cat_id = cat.get("id")
            parent_id = cat.get("parentId")
            result["categories"][cat_id] = {
                "id": cat_id,
                "name": cat.text or "",
                "parent_id": parent_id
            }
        
        # Товары (offers)
        offers = root.findall(".//offer")
        for offer in offers:
            product = FeedParser._parse_offer(offer, result["categories"])
            if product:
                result["products"].append(product)
        
        return result
    
    @staticmethod
    def _parse_offer(offer: ET.Element, categories: Dict) -> Optional[Dict[str, Any]]:
        """Парсинг одного товара (offer)"""
        try:
            offer_id = offer.get("id", "")
            available = offer.get("available", "true").lower() == "true"
            
            # Основные поля
            name = offer.findtext("name", "")
            if not name:
                # Альтернативный формат: typePrefix + vendor + model
                type_prefix = offer.findtext("typePrefix", "")
                vendor = offer.findtext("vendor", "")
                model = offer.findtext("model", "")
                name = " ".join(filter(None, [type_prefix, vendor, model]))
            
            price_text = offer.findtext("price", "0")
            try:
                price = float(price_text)
            except ValueError:
                price = 0
            
            old_price_text = offer.findtext("oldprice", "")
            old_price = None
            if old_price_text:
                try:
                    old_price = float(old_price_text)
                except ValueError:
                    pass
            
            currency = offer.findtext("currencyId", "RUB")
            
            # Категория
            category_id = offer.findtext("categoryId", "")
            category_name = ""
            if category_id and category_id in categories:
                category_name = categories[category_id].get("name", "")
            
            # URL и изображения
            url = offer.findtext("url", "")
            
            # Может быть несколько картинок
            pictures = []
            for pic in offer.findall("picture"):
                if pic.text:
                    pictures.append(pic.text)
            
            # Описание
            description = offer.findtext("description", "")
            
            # Vendor / Brand
            vendor = offer.findtext("vendor", "")
            
            # Артикул
            vendor_code = offer.findtext("vendorCode", "")
            
            # Параметры товара
            params = {}
            for param in offer.findall("param"):
                param_name = param.get("name", "")
                param_value = param.text or ""
                if param_name:
                    params[param_name] = param_value
            
            return {
                "id": offer_id,
                "name": name,
                "price": price,
                "old_price": old_price,
                "currency": currency,
                "in_stock": available,
                "category_id": category_id,
                "category": category_name,
                "url": url,
                "images": pictures,
                "image": pictures[0] if pictures else "",
                "description": description,
                "brand": vendor,
                "vendor_code": vendor_code,
                "params": params
            }
        except Exception as e:
            print(f"Error parsing offer: {e}")
            return None
    
    @staticmethod
    async def load_and_parse(url: str) -> Dict[str, Any]:
        """Загрузка и парсинг фида"""
        xml_content = await FeedParser.fetch_feed(url)
        return FeedParser.parse_yml(xml_content)


class FeedManager:
    """Менеджер фидов - загрузка, обновление, статистика"""
    
    def __init__(self, redis_client):
        self.redis = redis_client
        self.parser = FeedParser()
    
    async def load_feed(self, project_id: str, feed_url: str) -> Dict[str, Any]:
        """Загрузка фида для проекта"""
        try:
            print(f"[FeedManager] Loading feed from {feed_url} for project {project_id}")
            
            # Загружаем и парсим
            data = await self.parser.load_and_parse(feed_url)
            
            print(f"[FeedManager] Parsed {len(data['products'])} products, {len(data['categories'])} categories")
            
            # Сохраняем метаданные фида
            feed_info = {
                "url": feed_url,
                "last_update": datetime.utcnow().isoformat(),
                "products_count": len(data["products"]),
                "categories_count": len(data["categories"]),
                "shop_name": data["shop"].get("name", ""),
                "status": "success"
            }
            
            import json
            await self.redis.hset(
                f"project:{project_id}:feed",
                mapping={k: json.dumps(v) if isinstance(v, (dict, list)) else str(v) for k, v in feed_info.items()}
            )
            
            return {
                "success": True,
                "products_count": len(data["products"]),
                "categories_count": len(data["categories"]),
                "shop": data["shop"],
                "products": data["products"]
            }
            
        except Exception as e:
            # Сохраняем ошибку
            print(f"[FeedManager] Error loading feed: {e}")
            import json
            await self.redis.hset(
                f"project:{project_id}:feed",
                mapping={
                    "url": feed_url,
                    "last_update": datetime.utcnow().isoformat(),
                    "status": "error",
                    "error": str(e)
                }
            )
            return {
                "success": False,
                "error": str(e)
            }
    
    async def get_feed_status(self, project_id: str) -> Optional[Dict]:
        """Получение статуса фида проекта"""
        data = await self.redis.hgetall(f"project:{project_id}:feed")
        if not data:
            return None
        
        # Декодируем bytes в строки
        result = {}
        for k, v in data.items():
            key = k.decode() if isinstance(k, bytes) else k
            val = v.decode() if isinstance(v, bytes) else v
            result[key] = val
        
        return result
