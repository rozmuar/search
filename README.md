# 🔍 External Search Service

Сервис внешнего поиска для интернет-магазинов. Позволяет добавить быстрый и умный поиск на любой сайт через JavaScript виджет.

## 🚀 Быстрый старт

### Вариант 1: API + Веб-интерфейс

```powershell
# 1. Запустите API
docker-compose up -d

# 2. Запустите веб-интерфейс
cd src/web
python -m http.server 3000

# 3. Откройте в браузере
start http://localhost:3000
```

### Вариант 2: Только API

```powershell
# 1. Клонируйте и запустите
git clone <repo-url>
cd search
docker-compose up -d

# 2. Протестируйте (после 15 секунд)
pip install httpx
python scripts/test_search.py
```

**Готово!** 
- 🌐 **Веб-интерфейс**: http://localhost:3000
- 🔌 **API**: http://localhost:8000
- 📚 **API Docs**: http://localhost:8000/docs

📖 **Документация:** [START_HERE.md](START_HERE.md) | [WEB_START.md](WEB_START.md) | [QUICKSTART.md](QUICKSTART.md)

---

## ✨ Основные возможности

### Версия 1.0 (Базовая - БЕЗ ML)

- 🔍 **Мгновенный поиск** — BM25-подобный алгоритм, 10-30ms
- 💡 **Умные подсказки** — автодополнение, prefix search
- 📦 **Простая индексация** — REST API для загрузки товаров
- ⚡ **N-gram поиск** — частичное совпадение, обработка опечаток
- 🎯 **Фильтры** — по цене, наличию, категории
- 🐳 **Docker** — запуск одной командой

### Версия 2.0 (Roadmap - С ML)

- 🧠 **Семантический поиск** — embeddings, vector DB
- 🎯 **Neural re-ranking** — улучшение качества топа
- ✍️ **Spell correction** — исправление опечаток
- 📊 **Аналитика** — трекинг запросов и кликов

## Архитектура

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           КЛИЕНТСКИЙ САЙТ                                │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    JavaScript Widget                              │    │
│  │  • Поисковая строка с подсказками                                │    │
│  │  • Отображение результатов                                       │    │
│  │  • Аналитика поисковых запросов                                  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           SEARCH API                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                   │
│  │   Search     │  │  Suggest     │  │   Admin      │                   │
│  │   Endpoint   │  │  Endpoint    │  │   API        │                   │
│  └──────────────┘  └──────────────┘  └──────────────┘                   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        SEARCH ENGINE                                     │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    Индекс поиска (Redis/Elasticsearch)            │   │
│  │  • Инвертированный индекс                                         │   │
│  │  • N-gram индекс для подсказок                                    │   │
│  │  • Индекс по категориям/атрибутам                                 │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        FEED PROCESSOR                                    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐          │
│  │  Full Feed      │  │  Delta Feed     │  │   Scheduler     │          │
│  │  Processor      │  │  (Price/Stock)  │  │                 │          │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Документация

- [Архитектура системы](docs/architecture.md)
- [Алгоритм поиска](docs/search-algorithm.md)
- [Обработка фидов](docs/feed-processing.md)
- [API документация](docs/api.md)
- [Интеграция виджета](docs/widget-integration.md)

---

## 📊 Производительность

**Версия 1.0 (без ML):**
- ⚡ Индексация: ~500-1000 товаров/сек
- 🔍 Поиск: 10-30ms (p95)
- 💾 RAM: ~200-300MB
- 🖥️ CPU: 2-4 ядра достаточно
- 📦 Масштабируемость: до 500K товаров

**Требования:**
- ✅ Работает на любом железе (CPU)
- ✅ НЕ требует GPU
- ✅ НЕ требует ML библиотек

---

## 📖 API Примеры

### Поиск товаров

```bash
curl "http://localhost:8000/api/v1/search?q=iphone&project_id=demo&limit=10"
```

**Ответ:**
```json
{
  "success": true,
  "query": "iphone",
  "total": 3,
  "items": [
    {
      "id": "iphone-15-pro",
      "name": "Apple iPhone 15 Pro 256GB",
      "price": 119990,
      "score": 8.5
    }
  ],
  "took_ms": 12
}
```

### Подсказки

```bash
curl "http://localhost:8000/api/v1/suggest?q=app&project_id=demo"
```

### Индексация

```bash
curl -X POST "http://localhost:8000/api/v1/index?project_id=demo" \
  -H "Content-Type: application/json" \
  -d '[{"id":"p1","name":"Product 1","price":1000,"in_stock":true}]'
```

---

## 🛠️ Технологии

- **Python 3.11+** — основной язык
- **FastAPI** — современный async веб-фреймворк
- **Redis** — для индексов и кэша
- **PostgreSQL** — для метаданных
- **Docker** — контейнеризация

---

## 📚 Документация

### Быстрый старт
- 📖 [START_HERE.md](START_HERE.md) — начните отсюда (3 минуты)
- 📖 [QUICKSTART.md](QUICKSTART.md) — подробная инструкция
- 📖 [CHEATSHEET.md](CHEATSHEET.md) — шпаргалка команд

### Архитектура
- 📐 [ARCHITECTURE.txt](ARCHITECTURE.txt) — визуальная схема
- 📋 [VERSION_1_SUMMARY.md](VERSION_1_SUMMARY.md) — что реализовано

### Детальная документация
- 🏗️ [Архитектура системы](docs/architecture.md)
- 🔍 [Алгоритм поиска](docs/search-algorithm.md)
- 🧠 [ML интеграция](docs/ml-integration.md) (roadmap)
- 📡 [API документация](docs/api.md)
- 🎨 [Интеграция виджета](docs/widget-integration.md)

---

## 🗂️ Структура проекта

```
search/
├── 📖 START_HERE.md              ← НАЧНИТЕ ОТСЮДА
├── 📖 QUICKSTART.md
├── 📖 CHEATSHEET.md
├── 🐳 docker-compose.yml
├── 🐳 Dockerfile
├── 📦 requirements-basic.txt     ← Без ML
├── 📦 requirements.txt           ← Полная версия (с ML)
│
├── src/
│   ├── api/                      ← FastAPI приложение
│   │   └── main.py
│   ├── search/                   ← Поисковый движок
│   │   ├── engine_simple.py
│   │   ├── indexer_simple.py
│   │   └── query_processor_simple.py
│   ├── web/                      ← 🌐 Веб-интерфейс (лендинг)
│   │   ├── index.html
│   │   ├── auth.html
│   │   └── styles.css
│   ├── core/                     ← Базовые модели
│   ├── ml/                       ← ML компоненты (v2.0)
│   ├── feed/                     ← Обработка фидов (v2.0)
│   └── widget/                   ← JavaScript виджет (v2.0)
│
├── docs/                         ← Документация
└── scripts/                      ← Утилиты и тесты
```

---

## 🔧 Разработка

### Локальный запуск (без Docker)

```powershell
# Установите зависимости
pip install -r requirements-basic.txt

# Запустите Redis и PostgreSQL локально

# Установите переменные окружения
$env:REDIS_HOST="localhost"
$env:DB_HOST="localhost"

# Запустите API
uvicorn src.api.main:app --reload
```

### Команды Makefile

```bash
make up         # Запустить все сервисы
make down       # Остановить
make logs       # Показать логи
make test       # Запустить тесты
make clean      # Очистить данные
```

---

## 🚀 Roadmap

### ✅ Version 1.0 (Текущая - БЕЗ ML)
- [x] BM25-подобный поиск
- [x] N-gram для fuzzy matching
- [x] Автодополнение (suggestions)
- [x] Фильтры (цена, наличие, категория)
- [x] REST API (FastAPI)
- [x] Docker окружение
- [x] Тесты и документация

### 🎯 Version 2.0 (С ML - требует GPU)
- [ ] Semantic search (embeddings + vector DB)
- [ ] Neural re-ranker (cross-encoder)
- [ ] Advanced spell correction
- [ ] Query understanding
- [ ] Персонализация

### 🎯 Version 3.0 (Production-ready)
- [ ] Аутентификация и API ключи
- [ ] Rate limiting
- [ ] Аналитика и дашборды
- [ ] Feed processor (XML/JSON)
- [ ] Admin panel
- [ ] JavaScript widget

---

## 🤝 Вклад

Проект открыт для улучшений! Pull requests приветствуются.

---

## 📄 Лицензия

MIT

---

## 🎉 Статус

**✅ Version 1.0 - ГОТОВА К ИСПОЛЬЗОВАНИЮ!**

- Работает из коробки
- Не требует GPU
- Запускается за 3 минуты
- Протестирована
- Задокументирована

**Начните с [START_HERE.md](START_HERE.md)** 🚀
