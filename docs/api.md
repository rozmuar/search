# API документация

## Аутентификация

Все запросы к API требуют API ключа проекта.

```
Authorization: Bearer <API_KEY>
```

или через query параметр:

```
?api_key=<API_KEY>
```

## Endpoints

### 1. Поиск товаров

```
GET /api/v1/search
```

#### Параметры

| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| q | string | Да | Поисковый запрос |
| limit | int | Нет | Количество результатов (default: 20, max: 100) |
| offset | int | Нет | Смещение для пагинации (default: 0) |
| sort | string | Нет | Сортировка: relevance, price_asc, price_desc, popular |
| in_stock | bool | Нет | Только товары в наличии |
| price_min | float | Нет | Минимальная цена |
| price_max | float | Нет | Максимальная цена |
| category | string | Нет | Фильтр по категории |

#### Пример запроса

```bash
curl -X GET "https://api.search-service.com/api/v1/search?q=кроссовки+nike&limit=10&in_stock=true" \
  -H "Authorization: Bearer sk_live_xxx"
```

#### Пример ответа

```json
{
  "success": true,
  "query": "кроссовки nike",
  "total": 156,
  "items": [
    {
      "id": "SKU-12345",
      "name": "Кроссовки Nike Air Max 90",
      "description": "Легендарные кроссовки...",
      "url": "https://shop.com/products/nike-air-max-90",
      "image": "https://shop.com/images/nike-air-max-90.jpg",
      "price": 12990,
      "old_price": 15990,
      "discount_percent": 19,
      "currency": "RUB",
      "in_stock": true,
      "category": "Обувь > Кроссовки",
      "brand": "Nike",
      "highlight": {
        "name": "<em>Кроссовки</em> <em>Nike</em> Air Max 90"
      },
      "score": 0.95
    }
  ],
  "facets": {
    "categories": [
      {"value": "Кроссовки", "count": 89},
      {"value": "Кеды", "count": 45}
    ],
    "brands": [
      {"value": "Nike", "count": 156}
    ],
    "price_ranges": [
      {"min": 0, "max": 5000, "count": 12},
      {"min": 5000, "max": 10000, "count": 45},
      {"min": 10000, "max": 20000, "count": 78}
    ]
  },
  "meta": {
    "took_ms": 23,
    "query_corrected": false
  }
}
```

---

### 2. Подсказки (автодополнение)

```
GET /api/v1/suggest
```

#### Параметры

| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| q | string | Да | Префикс для подсказок |
| limit | int | Нет | Количество подсказок (default: 10) |
| include_products | bool | Нет | Включить товары в ответ (default: true) |
| include_categories | bool | Нет | Включить категории (default: true) |

#### Пример запроса

```bash
curl -X GET "https://api.search-service.com/api/v1/suggest?q=крос&limit=5" \
  -H "Authorization: Bearer sk_live_xxx"
```

#### Пример ответа

```json
{
  "success": true,
  "prefix": "крос",
  "suggestions": {
    "queries": [
      {
        "text": "кроссовки",
        "count": 1250,
        "highlight": "<em>крос</em>совки"
      },
      {
        "text": "кроссовки nike",
        "count": 156,
        "highlight": "<em>крос</em>совки nike"
      },
      {
        "text": "кроссовки adidas",
        "count": 134,
        "highlight": "<em>крос</em>совки adidas"
      }
    ],
    "categories": [
      {
        "name": "Кроссовки",
        "count": 1250,
        "url": "/category/sneakers"
      }
    ],
    "products": [
      {
        "id": "SKU-12345",
        "name": "Кроссовки Nike Air Max 90",
        "image": "https://...",
        "price": 12990,
        "url": "https://..."
      }
    ]
  },
  "meta": {
    "took_ms": 8
  }
}
```

---

### 3. Получение товара по ID

```
GET /api/v1/products/{product_id}
```

#### Пример ответа

```json
{
  "success": true,
  "product": {
    "id": "SKU-12345",
    "name": "Кроссовки Nike Air Max 90",
    "description": "...",
    "url": "https://...",
    "image": "https://...",
    "images": ["https://..."],
    "price": 12990,
    "old_price": 15990,
    "in_stock": true,
    "quantity": 15,
    "category": "Обувь > Кроссовки",
    "brand": "Nike",
    "attributes": {
      "Цвет": "Белый",
      "Размеры": ["42", "43", "44"],
      "Материал": "Кожа, текстиль"
    }
  }
}
```

---

### 4. Похожие товары

```
GET /api/v1/products/{product_id}/similar
```

#### Параметры

| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| limit | int | Нет | Количество (default: 10) |

#### Пример ответа

```json
{
  "success": true,
  "product_id": "SKU-12345",
  "similar": [
    {
      "id": "SKU-12346",
      "name": "Кроссовки Nike Air Max 95",
      "price": 14990,
      "image": "https://...",
      "similarity_score": 0.89
    }
  ]
}
```

---

### 5. Популярные запросы

```
GET /api/v1/popular
```

#### Параметры

| Параметр | Тип | Обязательный | Описание |
|----------|-----|--------------|----------|
| limit | int | Нет | Количество (default: 10) |
| period | string | Нет | Период: day, week, month |

#### Пример ответа

```json
{
  "success": true,
  "queries": [
    {"text": "кроссовки", "count": 5420},
    {"text": "nike air max", "count": 3210},
    {"text": "куртка зимняя", "count": 2890}
  ]
}
```

---

## Admin API

### 1. Создание проекта

```
POST /api/v1/admin/projects
```

#### Тело запроса

```json
{
  "name": "Мой магазин",
  "domain": "myshop.com",
  "settings": {
    "language": "ru",
    "currency": "RUB"
  }
}
```

#### Ответ

```json
{
  "success": true,
  "project": {
    "id": "proj_abc123",
    "name": "Мой магазин",
    "domain": "myshop.com",
    "api_key": "sk_live_xxxxxxxxxxxxx",
    "created_at": "2024-01-15T10:00:00Z"
  }
}
```

---

### 2. Настройка фидов

```
POST /api/v1/admin/projects/{project_id}/feeds
```

#### Тело запроса

```json
{
  "type": "full",
  "url": "https://myshop.com/feed.xml",
  "format": "yml",
  "update_interval": 3600
}
```

#### Ответ

```json
{
  "success": true,
  "feed": {
    "id": "feed_xyz789",
    "type": "full",
    "url": "https://myshop.com/feed.xml",
    "format": "yml",
    "update_interval": 3600,
    "status": "pending",
    "created_at": "2024-01-15T10:00:00Z"
  }
}
```

---

### 3. Добавление delta-фида

```
POST /api/v1/admin/projects/{project_id}/feeds
```

#### Тело запроса

```json
{
  "type": "delta",
  "url": "https://myshop.com/stock-feed.xml",
  "format": "yml",
  "update_interval": 300
}
```

---

### 4. Управление синонимами

```
POST /api/v1/admin/projects/{project_id}/synonyms
```

#### Тело запроса

```json
{
  "synonyms": [
    {
      "word": "телефон",
      "synonyms": ["смартфон", "мобильный", "сотовый"]
    },
    {
      "word": "ноутбук",
      "synonyms": ["лэптоп", "laptop", "ноут"]
    }
  ]
}
```

---

### 5. Статистика проекта

```
GET /api/v1/admin/projects/{project_id}/stats
```

#### Параметры

| Параметр | Тип | Описание |
|----------|-----|----------|
| period | string | day, week, month |

#### Ответ

```json
{
  "success": true,
  "stats": {
    "period": "day",
    "total_searches": 15420,
    "unique_queries": 3250,
    "zero_results_rate": 0.05,
    "avg_response_time_ms": 23,
    "popular_queries": [
      {"query": "кроссовки", "count": 542},
      {"query": "nike", "count": 321}
    ],
    "zero_result_queries": [
      {"query": "абракадабра", "count": 5}
    ]
  }
}
```

---

## Webhooks

### События

| Событие | Описание |
|---------|----------|
| feed.processing | Начало обработки фида |
| feed.completed | Успешная обработка фида |
| feed.failed | Ошибка обработки фида |

### Формат webhook

```json
{
  "event": "feed.completed",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "feed_id": "feed_xyz789",
    "project_id": "proj_abc123",
    "items_count": 15420,
    "duration_seconds": 45
  }
}
```

---

## Rate Limits

| План | Запросов/минуту | Запросов/день |
|------|-----------------|---------------|
| Free | 60 | 10,000 |
| Pro | 600 | 100,000 |
| Enterprise | Без ограничений | Без ограничений |

### Заголовки ответа

```
X-RateLimit-Limit: 600
X-RateLimit-Remaining: 599
X-RateLimit-Reset: 1705312800
```

---

## Коды ошибок

| Код | Описание |
|-----|----------|
| 400 | Неверные параметры запроса |
| 401 | Неверный API ключ |
| 403 | Доступ запрещён |
| 404 | Ресурс не найден |
| 429 | Превышен лимит запросов |
| 500 | Внутренняя ошибка сервера |

### Формат ошибки

```json
{
  "success": false,
  "error": {
    "code": "INVALID_API_KEY",
    "message": "API key is invalid or expired",
    "details": {}
  }
}
```
