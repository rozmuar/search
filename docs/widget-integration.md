# Интеграция виджета поиска

## Быстрый старт

### 1. Подключение скрипта

Добавьте скрипт перед закрывающим тегом `</body>`:

```html
<script src="https://cdn.search-service.com/widget.js"></script>
<script>
  SearchWidget.init({
    apiKey: 'sk_live_xxxxxxxxxxxxx',
    selector: '#search-input',  // CSS селектор поля поиска
  });
</script>
```

### 2. Минимальная разметка

```html
<input type="text" id="search-input" placeholder="Поиск товаров...">
```

Виджет автоматически:
- Перехватывает ввод в поле поиска
- Показывает подсказки по мере ввода
- Выводит результаты поиска

---

## Конфигурация

### Полный список опций

```javascript
SearchWidget.init({
  // Обязательные
  apiKey: 'sk_live_xxxxxxxxxxxxx',
  
  // Селекторы элементов
  selector: '#search-input',           // Поле ввода
  resultsSelector: '#search-results',  // Контейнер результатов (опционально)
  
  // Поведение
  minChars: 2,                         // Мин. символов для поиска
  debounceMs: 150,                     // Задержка перед запросом
  
  // Подсказки
  suggestions: {
    enabled: true,
    limit: 10,
    showProducts: true,                // Показывать товары в подсказках
    showCategories: true,              // Показывать категории
    productLimit: 4,                   // Кол-во товаров в подсказках
  },
  
  // Результаты поиска
  results: {
    limit: 20,                         // Товаров на странице
    showFilters: true,                 // Показывать фильтры
    showSorting: true,                 // Показывать сортировку
    highlightMatches: true,            // Подсветка совпадений
  },
  
  // Фильтры
  filters: {
    price: true,
    category: true,
    brand: true,
    inStock: true,
  },
  
  // Аналитика
  analytics: {
    enabled: true,
    trackClicks: true,                 // Отслеживать клики
    trackConversions: true,            // Отслеживать покупки
  },
  
  // Внешний вид
  theme: 'light',                      // light | dark | auto
  zIndex: 9999,
  
  // Локализация
  locale: 'ru',
  currency: 'RUB',
  
  // Callbacks
  onSearch: (query, results) => {},
  onSuggest: (query, suggestions) => {},
  onClick: (product) => {},
  onAddToCart: (product) => {},
});
```

---

## Кастомизация внешнего вида

### CSS переменные

```css
:root {
  /* Цвета */
  --search-primary-color: #007bff;
  --search-text-color: #333;
  --search-background: #fff;
  --search-border-color: #ddd;
  --search-highlight-color: #fff3cd;
  
  /* Размеры */
  --search-border-radius: 8px;
  --search-font-size: 14px;
  --search-input-height: 44px;
  
  /* Тени */
  --search-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
```

### Переопределение стилей

```css
/* Контейнер подсказок */
.search-widget-suggestions {
  max-height: 400px;
  border-radius: var(--search-border-radius);
}

/* Элемент подсказки */
.search-widget-suggestion-item {
  padding: 12px 16px;
}

.search-widget-suggestion-item:hover {
  background: var(--search-highlight-color);
}

/* Товар в подсказках */
.search-widget-product {
  display: flex;
  align-items: center;
  gap: 12px;
}

.search-widget-product-image {
  width: 50px;
  height: 50px;
  object-fit: contain;
}

.search-widget-product-price {
  font-weight: bold;
  color: var(--search-primary-color);
}

/* Подсветка совпадений */
.search-widget-highlight {
  background: var(--search-highlight-color);
  font-weight: bold;
}
```

---

## Шаблоны (Templates)

### Кастомный шаблон подсказки

```javascript
SearchWidget.init({
  apiKey: 'sk_live_xxx',
  selector: '#search-input',
  
  templates: {
    // Шаблон подсказки запроса
    querySuggestion: (suggestion) => `
      <div class="suggestion-query">
        <svg class="icon">...</svg>
        <span>${suggestion.highlight}</span>
        <span class="count">${suggestion.count}</span>
      </div>
    `,
    
    // Шаблон категории
    categorySuggestion: (category) => `
      <div class="suggestion-category">
        <span>в категории</span>
        <a href="${category.url}">${category.name}</a>
      </div>
    `,
    
    // Шаблон товара в подсказках
    productSuggestion: (product) => `
      <a href="${product.url}" class="suggestion-product">
        <img src="${product.image}" alt="${product.name}">
        <div class="info">
          <div class="name">${product.name}</div>
          <div class="price">${formatPrice(product.price)}</div>
        </div>
      </a>
    `,
    
    // Шаблон карточки товара в результатах
    productCard: (product) => `
      <div class="product-card" data-id="${product.id}">
        <a href="${product.url}">
          <img src="${product.image}" alt="${product.name}">
          <h3>${product.highlight?.name || product.name}</h3>
          <div class="price">
            ${product.old_price ? `<span class="old">${formatPrice(product.old_price)}</span>` : ''}
            <span class="current">${formatPrice(product.price)}</span>
          </div>
          ${product.in_stock ? '<span class="in-stock">В наличии</span>' : '<span class="out-of-stock">Нет в наличии</span>'}
        </a>
        <button class="add-to-cart" onclick="addToCart('${product.id}')">
          В корзину
        </button>
      </div>
    `,
    
    // Шаблон пустых результатов
    noResults: (query) => `
      <div class="no-results">
        <h3>По запросу "${query}" ничего не найдено</h3>
        <p>Попробуйте изменить запрос или посмотрите популярные товары</p>
      </div>
    `,
  }
});
```

---

## События (Events)

### Подписка на события

```javascript
SearchWidget.on('search', (event) => {
  console.log('Поиск:', event.query);
  console.log('Результатов:', event.results.total);
});

SearchWidget.on('suggest', (event) => {
  console.log('Подсказки для:', event.prefix);
});

SearchWidget.on('click', (event) => {
  console.log('Клик по товару:', event.product.id);
  console.log('Позиция в выдаче:', event.position);
});

SearchWidget.on('addToCart', (event) => {
  console.log('Добавлено в корзину:', event.product.id);
});

// Отписка
const handler = (event) => { ... };
SearchWidget.on('search', handler);
SearchWidget.off('search', handler);
```

### Список событий

| Событие | Описание | Данные |
|---------|----------|--------|
| `init` | Виджет инициализирован | `{ config }` |
| `search` | Выполнен поиск | `{ query, results }` |
| `suggest` | Получены подсказки | `{ prefix, suggestions }` |
| `click` | Клик по товару | `{ product, position, query }` |
| `addToCart` | Добавление в корзину | `{ product }` |
| `filter` | Применён фильтр | `{ filters }` |
| `sort` | Изменена сортировка | `{ sort }` |
| `error` | Ошибка | `{ error, context }` |

---

## API виджета

### Методы

```javascript
// Выполнить поиск программно
SearchWidget.search('кроссовки nike');

// Получить подсказки
SearchWidget.suggest('крос').then(suggestions => {
  console.log(suggestions);
});

// Очистить поиск
SearchWidget.clear();

// Закрыть подсказки
SearchWidget.closeSuggestions();

// Обновить конфигурацию
SearchWidget.setConfig({
  results: { limit: 30 }
});

// Получить текущее состояние
const state = SearchWidget.getState();
// { query: 'кроссовки', results: [...], filters: {...} }

// Уничтожить виджет
SearchWidget.destroy();
```

---

## Отслеживание конверсий

### Отправка события покупки

```javascript
// При оформлении заказа
SearchWidget.trackConversion({
  orderId: 'ORDER-123',
  products: [
    { id: 'SKU-12345', quantity: 1, price: 12990 },
    { id: 'SKU-67890', quantity: 2, price: 4990 },
  ],
  total: 22970,
  searchQuery: 'кроссовки nike', // Если покупка из поиска
});
```

### Отслеживание добавления в корзину

```javascript
// При добавлении товара в корзину
document.querySelectorAll('.add-to-cart-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const productId = e.target.dataset.productId;
    
    SearchWidget.trackAddToCart({
      productId: productId,
      searchQuery: SearchWidget.getState().query,
    });
  });
});
```

---

## Интеграция с существующим поиском

### Режим "только подсказки"

```javascript
SearchWidget.init({
  apiKey: 'sk_live_xxx',
  selector: '#search-input',
  
  // Отключаем встроенную страницу результатов
  results: {
    enabled: false,
  },
  
  // При поиске редиректим на вашу страницу
  onSearch: (query) => {
    window.location.href = `/search?q=${encodeURIComponent(query)}`;
  },
});
```

### Использование на странице результатов

```javascript
// На странице /search
SearchWidget.init({
  apiKey: 'sk_live_xxx',
  selector: '#search-input',
  resultsSelector: '#results-container',
  
  // Считываем запрос из URL
  initialQuery: new URLSearchParams(location.search).get('q'),
  
  // Обновляем URL при поиске
  onSearch: (query) => {
    history.pushState(null, '', `/search?q=${encodeURIComponent(query)}`);
  },
});
```

---

## Примеры интеграции

### React

```jsx
import { useEffect, useRef } from 'react';

function SearchBox() {
  const inputRef = useRef(null);
  
  useEffect(() => {
    // Загружаем скрипт виджета
    const script = document.createElement('script');
    script.src = 'https://cdn.search-service.com/widget.js';
    script.onload = () => {
      window.SearchWidget.init({
        apiKey: 'sk_live_xxx',
        selector: inputRef.current,
      });
    };
    document.body.appendChild(script);
    
    return () => {
      window.SearchWidget?.destroy();
    };
  }, []);
  
  return <input ref={inputRef} type="text" placeholder="Поиск..." />;
}
```

### Vue

```vue
<template>
  <input ref="searchInput" type="text" placeholder="Поиск..." />
</template>

<script>
export default {
  mounted() {
    this.loadWidget();
  },
  
  beforeUnmount() {
    window.SearchWidget?.destroy();
  },
  
  methods: {
    loadWidget() {
      const script = document.createElement('script');
      script.src = 'https://cdn.search-service.com/widget.js';
      script.onload = () => {
        window.SearchWidget.init({
          apiKey: 'sk_live_xxx',
          selector: this.$refs.searchInput,
        });
      };
      document.body.appendChild(script);
    }
  }
}
</script>
```

---

## Troubleshooting

### Виджет не отображается

1. Проверьте, что скрипт загружен
2. Проверьте правильность селектора
3. Убедитесь, что элемент существует в DOM до инициализации
4. Проверьте консоль на наличие ошибок

### Подсказки не появляются

1. Проверьте API ключ
2. Убедитесь, что фид успешно загружен
3. Проверьте `minChars` (по умолчанию 2)
4. Проверьте сетевые запросы в DevTools

### Конфликт стилей

```javascript
SearchWidget.init({
  apiKey: 'sk_live_xxx',
  selector: '#search-input',
  
  // Отключаем встроенные стили
  injectStyles: false,
});
```

Затем подключите свои стили или модифицированные стили виджета.
