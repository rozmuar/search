"""
Тестовый скрипт для проверки поискового сервиса
Загружает демо данные и тестирует поиск
"""
import asyncio
import httpx
import json


# Тестовые данные - товары электроники
DEMO_PRODUCTS = [
    {
        "id": "iphone-15-pro",
        "name": "Apple iPhone 15 Pro 256GB Титановый",
        "description": "Новый iPhone 15 Pro с титановым корпусом, чипом A17 Pro и камерой 48 МП",
        "url": "https://shop.com/iphone-15-pro",
        "image": "https://example.com/iphone15pro.jpg",
        "price": 119990,
        "old_price": 129990,
        "in_stock": True,
        "category": "Смартфоны",
        "brand": "Apple"
    },
    {
        "id": "samsung-s24-ultra",
        "name": "Samsung Galaxy S24 Ultra 512GB Черный",
        "description": "Флагманский смартфон Samsung с пером S Pen, камерой 200 МП",
        "url": "https://shop.com/samsung-s24",
        "image": "https://example.com/s24.jpg",
        "price": 109990,
        "old_price": None,
        "in_stock": True,
        "category": "Смартфоны",
        "brand": "Samsung"
    },
    {
        "id": "macbook-pro-14",
        "name": "Apple MacBook Pro 14 M3 Pro 18GB 512GB",
        "description": "Профессиональный ноутбук с чипом M3 Pro, дисплеем Liquid Retina XDR",
        "url": "https://shop.com/macbook-pro",
        "image": "https://example.com/macbook.jpg",
        "price": 229990,
        "old_price": 249990,
        "in_stock": True,
        "category": "Ноутбуки",
        "brand": "Apple"
    },
    {
        "id": "airpods-pro-2",
        "name": "Apple AirPods Pro 2 с USB-C",
        "description": "Беспроводные наушники с активным шумоподавлением",
        "url": "https://shop.com/airpods-pro",
        "image": "https://example.com/airpods.jpg",
        "price": 24990,
        "old_price": 27990,
        "in_stock": True,
        "category": "Наушники",
        "brand": "Apple"
    },
    {
        "id": "sony-wh1000xm5",
        "name": "Sony WH-1000XM5 Черные",
        "description": "Флагманские наушники с лучшим шумоподавлением",
        "url": "https://shop.com/sony-wh1000xm5",
        "image": "https://example.com/sony.jpg",
        "price": 32990,
        "old_price": None,
        "in_stock": True,
        "category": "Наушники",
        "brand": "Sony"
    },
    {
        "id": "ipad-air-m2",
        "name": "Apple iPad Air M2 128GB Голубой",
        "description": "Планшет с чипом M2, дисплеем 11 дюймов",
        "url": "https://shop.com/ipad-air",
        "image": "https://example.com/ipad.jpg",
        "price": 64990,
        "old_price": None,
        "in_stock": True,
        "category": "Планшеты",
        "brand": "Apple"
    },
    {
        "id": "dyson-v15",
        "name": "Dyson V15 Detect Absolute",
        "description": "Беспроводной пылесос с лазерным детектором пыли",
        "url": "https://shop.com/dyson-v15",
        "image": "https://example.com/dyson.jpg",
        "price": 59990,
        "old_price": 64990,
        "in_stock": True,
        "category": "Пылесосы",
        "brand": "Dyson"
    },
    {
        "id": "watch-ultra-2",
        "name": "Apple Watch Ultra 2 49mm Титановый",
        "description": "Умные часы для экстремальных условий",
        "url": "https://shop.com/watch-ultra",
        "image": "https://example.com/watch.jpg",
        "price": 89990,
        "old_price": None,
        "in_stock": False,
        "category": "Умные часы",
        "brand": "Apple"
    },
    {
        "id": "playstation-5",
        "name": "Sony PlayStation 5 Slim 1TB",
        "description": "Игровая консоль нового поколения",
        "url": "https://shop.com/ps5",
        "image": "https://example.com/ps5.jpg",
        "price": 54990,
        "old_price": None,
        "in_stock": True,
        "category": "Игровые консоли",
        "brand": "Sony"
    },
    {
        "id": "logitech-mx-master-3s",
        "name": "Logitech MX Master 3S Графитовая",
        "description": "Беспроводная мышь для профессионалов",
        "url": "https://shop.com/mx-master",
        "image": "https://example.com/mouse.jpg",
        "price": 10990,
        "old_price": None,
        "in_stock": True,
        "category": "Мыши",
        "brand": "Logitech"
    },
]


API_URL = "http://localhost:8000"


async def index_demo_products():
    """Загрузка демо товаров в индекс"""
    print("\n📦 Загрузка демо товаров...")
    
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{API_URL}/api/v1/index",
            params={"project_id": "demo"},
            json=DEMO_PRODUCTS,
            timeout=30.0
        )
        
        if response.status_code == 200:
            result = response.json()
            print(f"✓ Индексировано товаров: {result['indexed']}")
        else:
            print(f"✗ Ошибка: {response.text}")


async def test_search(query: str):
    """Тестирование поиска"""
    print(f"\n🔍 Поиск: '{query}'")
    
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{API_URL}/api/v1/search",
            params={
                "q": query,
                "project_id": "demo",
                "limit": 5
            }
        )
        
        if response.status_code == 200:
            result = response.json()
            print(f"   Найдено: {result['total']} товаров за {result['meta']['took_ms']}ms")
            
            for i, item in enumerate(result['items'][:3], 1):
                print(f"   {i}. {item['name']}")
                print(f"      Цена: {item['price']} руб. | Скор: {item['score']}")
        else:
            print(f"   ✗ Ошибка: {response.text}")


async def test_suggest(prefix: str):
    """Тестирование подсказок"""
    print(f"\n💡 Подсказки для: '{prefix}'")
    
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{API_URL}/api/v1/suggest",
            params={
                "q": prefix,
                "project_id": "demo",
                "limit": 5,
                "include_products": True
            }
        )
        
        if response.status_code == 200:
            result = response.json()
            print(f"   Подсказки: {', '.join(result['suggestions'][:5])}")
            
            if result.get('products'):
                print(f"   Товары:")
                for item in result['products'][:2]:
                    print(f"   - {item['name']} ({item['price']} руб.)")
        else:
            print(f"   ✗ Ошибка: {response.text}")


async def test_filters():
    """Тестирование фильтров"""
    print(f"\n🎯 Поиск с фильтрами: Apple до 100000 руб.")
    
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{API_URL}/api/v1/search",
            params={
                "q": "apple",
                "project_id": "demo",
                "price_max": 100000,
                "in_stock": True,
                "limit": 10
            }
        )
        
        if response.status_code == 200:
            result = response.json()
            print(f"   Найдено: {result['total']} товаров")
            
            for item in result['items'][:5]:
                print(f"   - {item['name']}: {item['price']} руб.")
        else:
            print(f"   ✗ Ошибка: {response.text}")


async def main():
    """Главная функция"""
    print("=" * 60)
    print("🚀 Тестирование поискового сервиса")
    print("=" * 60)
    
    # Проверка доступности API
    print("\n🔌 Проверка подключения к API...")
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{API_URL}/health", timeout=5.0)
            if response.status_code == 200:
                print("✓ API доступен")
            else:
                print("✗ API недоступен")
                return
    except Exception as e:
        print(f"✗ Ошибка подключения: {e}")
        print("\nУбедитесь, что сервис запущен:")
        print("  docker-compose up -d")
        return
    
    # Загрузка данных
    await index_demo_products()
    
    # Задержка для индексации
    await asyncio.sleep(1)
    
    # Тесты поиска
    print("\n" + "=" * 60)
    print("ТЕСТЫ ПОИСКА")
    print("=" * 60)
    
    await test_search("iphone")
    await test_search("наушники")
    await test_search("apple")
    await test_search("беспроводные")
    await test_search("ноутбук")
    
    # Тесты подсказок
    print("\n" + "=" * 60)
    print("ТЕСТЫ ПОДСКАЗОК")
    print("=" * 60)
    
    await test_suggest("app")
    await test_suggest("sony")
    await test_suggest("наушн")
    
    # Тесты фильтров
    print("\n" + "=" * 60)
    print("ТЕСТЫ ФИЛЬТРОВ")
    print("=" * 60)
    
    await test_filters()
    
    print("\n" + "=" * 60)
    print("✓ Все тесты завершены!")
    print("=" * 60)
    print("\nAPI доступен по адресу: http://localhost:8000")
    print("Документация: http://localhost:8000/docs")


if __name__ == "__main__":
    asyncio.run(main())
