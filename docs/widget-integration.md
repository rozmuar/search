# Интеграция виджета поиска

> Сверено с реальным `src/web/embed.js` (класс `SearchWidgetClass`, глобально доступен как `window.SearchWidget`) и с тем, что дашборд реально показывает клиентам на вкладке "Код для сайта" (`src/web/dashboard.html`, `updateEmbedCode()` в `dashboard.js`). Предыдущая версия этого файла в целом была близка к реальности по форме конфига, но с фактическими неточностями (см. ниже) — они исправлены.
>
> ⚠️ В корне репозитория есть ещё файл `WIDGET_INTEGRATION.md`, описывающий **другой, нереализованный** API виджета (`<div id="searchpro-widget">` + `data-api-key` атрибут на `<script>` + глобальный `window.SearchProConfig`). Он не соответствует `embed.js` — используйте этот файл, а не тот.

## Быстрый старт (то, что реально показывает дашборд)

```html
<div id="search-widget"></div>
<script src="https://ваш-домен/embed.js"></script>
<script>
  SearchWidget.init({
    apiKey: 'ВАШ_API_КЛЮЧ',
    container: '#search-widget'
  });
</script>
```

Скрипт отдаётся статикой напрямую через nginx (`location = /embed.js` в `nginx.conf`, файл — `src/web/embed.js`), а не с CDN. Есть и второй путь — `GET /api/v1/widget/embed.js` через FastAPI (тот же файл), но клиентам показывается первый.

`container` — это просто алиас для `selector` (если передан `container` без `selector`, виджет использует его как `selector`). Если элемент по селектору — `<input>`, виджет использует его напрямую; если это, например, `<div>` — создаёт `<input>` внутри него сам.

`data-api-key` на теге `<script>` **не поддерживается** — `apiKey` передаётся только через объект конфига в `SearchWidget.init()`.

### Дропдаун категорий и полноэкранный вид результатов

Слева от поля ввода виджет сам добавляет `<select>` "Везде ▾" — список категорий подтягивается один раз при инициализации через `GET /api/v1/categories` (кэшируется на бэкенде 5 минут). Выбор категории ограничивает и dropdown-подсказки, и последующий "Показать все N товаров" этой категорией.

Клик по "Показать все N товаров" в dropdown-подсказках открывает не плоскую сетку с постраничной навигацией (как раньше), а вид с сайдбаром фасетов (категории со счётчиками, диапазон цен, авто-определённые параметры из фида — например "Вязкость"/"Допуски") и результатами, сгруппированными по категориям. Это перезапрашивает `/api/v1/search` с `facets=true` и текущими фильтрами при каждом изменении фильтра/сортировки — см. `showAllResultsPopup`/`refreshPopupResults` в `embed.js`, формат `filters`/`facets` — в [api.md](api.md).

---

## Конфигурация

Реальные поля `DEFAULT_CONFIG` в `embed.js` + то, что дополнительно подхватывается с сервера (`GET /api/v1/widget/{apiKey}/config`, настраивается в личном кабинете):

```javascript
SearchWidget.init({
  // Обязательно
  apiKey: 'sk_...',

  // Куда встраивать (селектор или сам DOM-элемент)
  selector: '#search-widget',   // или container: '#search-widget' - синоним

  // Поведение
  minChars: 2,        // мин. символов до запроса подсказок - реально используется
  debounceMs: 150,    // задержка перед запросом - реально используется
  placeholder: 'Поиск товаров...',

  suggestions: {
    enabled: true,
    limit: 10,
    showProducts: true,
    showCategories: true,   // объявлено, но категорийных подсказок нет - API их не отдаёт
    productLimit: 8,
  },

  results: {
    enabled: true,
    limit: 200,
    showFilters: true,      // объявлено в конфиге, но нигде не используется в рендере - мёртвая опция
    showSorting: true,      // аналогично - мёртвая опция
    highlightMatches: true, // аналогично - мёртвая опция
  },

  analytics: {
    enabled: true,
    trackClicks: true,
    trackConversions: true,
  },

  theme: 'light',
  zIndex: 9999,
  locale: 'ru',
  currency: 'RUB',

  // Опционально: если задан onSearch, виджет не показывает встроенную
  // страницу результатов и просто вызывает ваш колбэк вместо запроса
  onSearch: (query) => { window.location.href = `/search?q=${query}`; },

  // Выполнить поиск сразу при инициализации
  initialQuery: 'наушники',
});
```

Настройки, приходящие с сервера (`GET /widget/{apiKey}/config`, из `PUT /projects/{id}/widget` в личном кабинете) и реально применяемые поверх дефолтов: `placeholder`, `theme`, `primaryColor`, `borderRadius`, `showImages`, `showPrices`, `showButton`, `maxResults` (→ `results.limit`), `cartCallbackUrl`. Если запрос конфига падает — виджет тихо продолжает с локальными/дефолтными настройками.

### `cartCallbackUrl` — реальная кнопка "В корзину"

Настраивается в личном кабинете (вкладка "Виджет"). Когда задан, каждая карточка товара в новом виде результатов получает степпер количества и кнопку "В корзину"; клик POSTит на этот URL:
```json
{ "apiKey": "sk_...", "productId": "abc123", "quantity": 2,
  "product": { "id": "abc123", "name": "...", "price": 1990, "url": "...", "params": {} } }
```
`fetch` идёт с `mode: 'cors', credentials: 'omit'` — сервер клиента должен ответить `Access-Control-Allow-Origin`, иначе виджет не сможет отличить успех от ошибки (запрос при этом всё равно уйдёт). Если `cartCallbackUrl` не задан — кнопка есть, но клик — no-op с предупреждением в консоль (аналитика "добавления в корзину" всё равно фиксируется).

### Чего нет в конфиге, в отличие от прошлой версии документа

`resultsSelector` как отдельно настраиваемый контейнер результатов, `filters.{price,category,brand,inStock}` как переключатели, `templates` (кастомные HTML-шаблоны подсказок/карточек) — рендер зашит в `embed.js` и не параметризуется через конфиг.

---

## API виджета (`window.SearchWidget`)

Реальные публичные методы класса:

```javascript
// Выполнить поиск программно (то же, что ввод в поле + Enter)
SearchWidget.search('кроссовки nike');

// Очистить поле и результаты
SearchWidget.clear();

// Закрыть выпадашку подсказок
SearchWidget.closeSuggestions();

// Слить новые опции в текущий конфиг
SearchWidget.setConfig({ results: { limit: 30 } });

// Текущее состояние
const state = SearchWidget.getState();
// { query, results, filters, loading }

// Снять обработчики, убрать DOM
SearchWidget.destroy();

// Ручной трекинг (обычно вызывается виджетом автоматически)
SearchWidget.trackConversion({ orderId, products, total });
SearchWidget.trackAddToCart({ productId, quantity }); // только аналитика, не POSTит в cartCallbackUrl
```

**Публичного `SearchWidget.suggest(prefix)` не существует** — подсказки по вводу обрабатываются внутренним (не экспортированным) методом `fetchSuggestions`. Нет и `SearchWidget.refresh()`, и свойства `SearchWidget.config` для чтения текущего конфига — используйте `getState()`.

Есть также `SearchWidget.addToCart(product, quantity, buttonEl)` — то, что реально дёргает кнопка "В корзину" в новом виде результатов (POST в `cartCallbackUrl` + вызов `trackAddToCart`). Технически вызываем снаружи, но требует ссылку на DOM-кнопку для визуальной обратной связи (успех/ошибка) — не рассчитан как чистый публичный API, только как обработчик встроенной кнопки.

### События

```javascript
SearchWidget.on('search', ({ query, results }) => {});
SearchWidget.on('suggest', ({ prefix, suggestions }) => {});
SearchWidget.on('click', ({ productId, position, query }) => {});
SearchWidget.on('addToCart', (data) => {});
SearchWidget.on('init', ({ config }) => {});
SearchWidget.on('error', ({ error, context }) => {});   // context: 'search' | 'suggest'

SearchWidget.off('search', handler);
```

Нет событий `filter` и `sort` — фильтрация/сортировка на стороне виджета не реализована (см. выше про мёртвые опции `showFilters`/`showSorting`).

---

## Аналитика

Клик по товару и конверсии трекаются через `POST /api/v1/track/click` (клики) и внутренний вызов `api.trackEvent(...)`, который бьёт в `POST /api/v1/analytics/event` — но этот эндпоинт **игнорирует тело запроса** (см. [api.md](api.md)), так что реально в аналитике считаются только клики (`track/click`), не события `search`/`conversion`/`add_to_cart` от виджета.

```javascript
SearchWidget.trackConversion({
  orderId: 'ORDER-123',
  products: [{ id: 'SKU-12345', quantity: 1, price: 12990 }],
  total: 22970,
});
```

---

## Кастомизация внешнего вида

CSS-классы в `embed.js` — с префиксом `search-widget-` (`.search-widget-suggestions`, `.search-widget-result-card`, `.search-widget-facet-card`, `.search-widget-category-select` и т.п.), а не `sp-*`/`.sw-*` из более старых версий документации. Каждый добавляемый в DOM тег `<style id="search-widget-styles">` идемпотентен — несколько виджетов на одной странице делят один инжектнутый стиль.

`injectStyles: false` в конфиге реально отключает вставку стилей (`initWidget()` вызывает `injectStyles()` только если `config.injectStyles !== false`) — подключайте свой CSS с теми же классами, если нужен полный контроль.

---

## Troubleshooting

### Виджет не отображается / подсказки не приходят
1. Проверьте, что `apiKey` в конфиге совпадает с ключом проекта в личном кабинете (вкладка "Виджет" → "Код для сайта").
2. Убедитесь, что фид загружен и `GET /api/v1/projects/{id}/index-stats` (с API-ключом) показывает `products_in_redis > 0`.
3. Проверьте консоль — виджет логирует `[SearchWidget] ...` на каждом шаге инициализации и при ошибках сети (`console.error`/`console.warn`).
4. `minChars` по умолчанию 2 — короче не запросит подсказки.

### Стили конфликтуют с сайтом
Отключить встроенные стили нельзя (см. выше) — переопределяйте `.search-widget-*` классы напрямую с более высокой специфичностью или `!important`.
