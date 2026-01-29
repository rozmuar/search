# ML интеграция в поисковый сервис

## Обзор

Интеграция нейросетей для улучшения качества поиска:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        ГИБРИДНЫЙ ПОИСК                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Запрос                                                                 │
│     │                                                                    │
│     ▼                                                                    │
│   ┌──────────────────────────────────────────────────────────┐          │
│   │              QUERY PROCESSING + ML                        │          │
│   │  1. Spell Correction (исправление опечаток)              │          │
│   │  2. Query Understanding (понимание интента)              │          │
│   │  3. Query Embedding (векторное представление)            │          │
│   └──────────────────────────────────────────────────────────┘          │
│                          │                                               │
│           ┌──────────────┴──────────────┐                               │
│           ▼                              ▼                               │
│   ┌───────────────┐              ┌───────────────┐                      │
│   │  BM25 Search  │              │ Vector Search │                      │
│   │  (keywords)   │              │  (semantic)   │                      │
│   │   top-100     │              │   top-100     │                      │
│   └───────┬───────┘              └───────┬───────┘                      │
│           │                              │                               │
│           └──────────────┬───────────────┘                               │
│                          ▼                                               │
│                  ┌───────────────┐                                       │
│                  │  Merge + RRF  │  (Reciprocal Rank Fusion)            │
│                  │   top-100     │                                       │
│                  └───────┬───────┘                                       │
│                          ▼                                               │
│                  ┌───────────────┐                                       │
│                  │ Neural        │                                       │
│                  │ Re-ranker     │  (Cross-encoder)                     │
│                  │   top-20      │                                       │
│                  └───────┬───────┘                                       │
│                          ▼                                               │
│                     Результаты                                           │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Компоненты

### 1. Embeddings (Векторные представления)

Преобразование текста в векторы для семантического поиска.

**Модели для русского языка:**

| Модель | Размер | Качество | Скорость |
|--------|--------|----------|----------|
| `intfloat/multilingual-e5-base` | 768 | ⭐⭐⭐⭐⭐ | Средняя |
| `cointegrated/rubert-tiny2` | 312 | ⭐⭐⭐ | Быстрая |
| `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` | 384 | ⭐⭐⭐⭐ | Быстрая |

**Пример:**
```python
query = "кеды для бега"
embedding = model.encode(query)  # [0.023, -0.156, 0.089, ...]

# Найдёт семантически похожие товары:
# - "беговые кроссовки" 
# - "спортивная обувь для бега"
# - "лёгкие кроссовки для пробежек"
```

### 2. Vector Search

Поиск по векторному сходству с использованием:

- **Redis Vector Search** — встроен в Redis Stack
- **Qdrant** — специализированная vector DB
- **Milvus** — масштабируемое решение
- **PostgreSQL + pgvector** — для простых случаев

### 3. Neural Re-ranker

Переранжирование топ-N результатов с помощью cross-encoder.

```python
# BM25 вернул:
results = ["Кроссовки Nike", "Кроссовки Adidas", "Кеды Converse", ...]

# Re-ranker оценивает релевантность каждой пары (query, product):
scores = reranker.score(query, results)

# Переупорядочивает по релевантности
```

**Модели:**
- `cross-encoder/ms-marco-MiniLM-L-6-v2`
- `BAAI/bge-reranker-base`

### 4. Spell Correction

Исправление опечаток с использованием:
- **Расстояние Левенштейна** — базовый метод
- **SymSpell** — быстрый алгоритм
- **T5/BERT** — нейросетевой подход

```python
"красныйе кросовки" → "красные кроссовки"
"айфн 15 про"       → "айфон 15 про"
```

## Архитектура индексации

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         ИНДЕКСАЦИЯ ТОВАРОВ                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Feed (XML/JSON)                                                        │
│        │                                                                 │
│        ▼                                                                 │
│   ┌──────────────────────────────────────────────────────────┐          │
│   │                    Feed Processor                         │          │
│   │  1. Parse                                                 │          │
│   │  2. Validate                                              │          │
│   │  3. Transform                                             │          │
│   └──────────────────────────────────────────────────────────┘          │
│        │                                                                 │
│        ▼                                                                 │
│   ┌──────────────────────────────────────────────────────────┐          │
│   │                  Embedding Generator                      │          │
│   │  • Batch processing (128 items)                          │          │
│   │  • GPU acceleration (if available)                       │          │
│   │  • Cache embeddings                                      │          │
│   └──────────────────────────────────────────────────────────┘          │
│        │                                                                 │
│        ├─────────────────────┬────────────────────┐                     │
│        ▼                     ▼                    ▼                     │
│   ┌──────────┐         ┌──────────┐        ┌──────────┐                │
│   │  Redis   │         │  Vector  │        │ Products │                │
│   │ Inverted │         │   DB     │        │   Data   │                │
│   │  Index   │         │ (Qdrant) │        │  (JSON)  │                │
│   └──────────┘         └──────────┘        └──────────┘                │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Метрики качества

| Метрика | Без ML | С ML (ожидание) |
|---------|--------|-----------------|
| Precision@10 | 0.65 | 0.82 |
| Recall@10 | 0.58 | 0.75 |
| NDCG@10 | 0.61 | 0.79 |
| Zero-results rate | 8% | 3% |
| Avg. response time | 25ms | 45ms |

## Ресурсы и требования

### Минимальные требования (CPU)

```yaml
Embedding Model: rubert-tiny2 (312 dims)
Vector DB: Redis Stack
Hardware:
  CPU: 4 cores
  RAM: 8 GB
  Storage: SSD

Performance:
  Indexing: ~100 products/sec
  Search: ~50ms p95
```

### Рекомендуемые (GPU)

```yaml
Embedding Model: multilingual-e5-base (768 dims)
Vector DB: Qdrant
Hardware:
  GPU: NVIDIA T4 / RTX 3060+
  CPU: 8 cores
  RAM: 16 GB
  Storage: NVMe SSD

Performance:
  Indexing: ~1000 products/sec
  Search: ~30ms p95
```

## Roadmap ML-улучшений

### Phase 1: Базовый семантический поиск
- [x] Embeddings для товаров
- [x] Vector search (HNSW index)
- [x] Гибридный поиск (BM25 + Vector)

### Phase 2: Улучшение качества
- [ ] Neural re-ranker
- [ ] Spell correction
- [ ] Query expansion

### Phase 3: Персонализация
- [ ] User embeddings
- [ ] Session-based recommendations
- [ ] A/B testing framework

### Phase 4: Advanced
- [ ] Query understanding (intent, filters)
- [ ] Multi-modal search (image + text)
- [ ] Real-time learning from clicks
