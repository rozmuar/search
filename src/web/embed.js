/**
 * SearchPro Widget - JavaScript виджет для внешнего поиска
 * Version: 1.0.3
 * 
 * Использование:
 * <script src="https://your-server.com/embed.js"></script>
 * <script>
 *   SearchWidget.init({
 *     apiKey: 'your_api_key',
 *     selector: '#search-input'
 *   });
 * </script>
 */

(function(window, document) {
  'use strict';

  // Определяем базовый URL из атрибута скрипта или текущего домена
  const currentScript = document.currentScript;
  const scriptSrc = currentScript?.src || '';
  const baseUrl = scriptSrc ? new URL(scriptSrc).origin : window.location.origin;

  const VERSION = '1.0.3';
  console.log('[SearchWidget] Loading embed.js version', VERSION);

  // ==================== Конфигурация ====================
  
  const DEFAULT_CONFIG = {
    apiUrl: baseUrl + '/api/v1',
    minChars: 2,
    debounceMs: 150,
    placeholder: 'Поиск товаров...',
    
    suggestions: {
      enabled: true,
      limit: 10,
      showProducts: true,
      showCategories: true,
      productLimit: 8,
    },
    
    results: {
      enabled: true,
      limit: 200,
      showFilters: true,
      showSorting: true,
      highlightMatches: true,
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
  };

  // ==================== Утилиты ====================
  
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  function formatPrice(price, currency = 'RUB') {
    const formats = {
      'RUB': { locale: 'ru-RU', currency: 'RUB' },
      'USD': { locale: 'en-US', currency: 'USD' },
      'EUR': { locale: 'de-DE', currency: 'EUR' },
    };
    
    const format = formats[currency] || formats['RUB'];
    
    return new Intl.NumberFormat(format.locale, {
      style: 'currency',
      currency: format.currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(price);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ==================== API клиент ====================
  
  class ApiClient {
    constructor(apiUrl, apiKey) {
      this.apiUrl = apiUrl;
      this.apiKey = apiKey;
    }

    async search(query, options = {}) {
      const params = new URLSearchParams({
        q: query,
        limit: options.limit || 20,
        offset: options.offset || 0,
      });

      if (options.sort) params.append('sort', options.sort);
      if (options.facets) params.append('facets', 'true');

      // Расширенные фильтры (category[]/params{}/min_price/max_price/in_stock)
      // уходят одним JSON-параметром - бэкенд ждёт именно такую форму,
      // плоский Object.entries тут не подходит (значения бывают массивами/объектами)
      if (options.filters && Object.keys(options.filters).length > 0) {
        params.append('filters', JSON.stringify(options.filters));
      }

      const response = await fetch(`${this.apiUrl}/search?${params}`, {
        headers: {
          'X-API-Key': this.apiKey,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`);
      }

      return response.json();
    }

    async categories() {
      const response = await fetch(`${this.apiUrl}/categories`, {
        headers: {
          'X-API-Key': this.apiKey,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Categories failed: ${response.status}`);
      }

      return response.json();
    }

    // POST в кастомный колбэк корзины клиента (widget_settings.cartCallbackUrl) -
    // это не наш API, поэтому CORS/ответ полностью на стороне сервера клиента.
    // В отличие от trackEvent - промис возвращается, чтобы вызывающий код
    // мог показать успех/ошибку добавления в корзину.
    postCart(callbackUrl, payload) {
      return fetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
        mode: 'cors',
        credentials: 'omit'
      });
    }

    async suggest(prefix, options = {}) {
      const params = new URLSearchParams({
        q: prefix,
        limit: options.limit || 10,
      });

      const response = await fetch(`${this.apiUrl}/suggest?${params}`, {
        headers: {
          'X-API-Key': this.apiKey,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Suggest failed: ${response.status}`);
      }

      return response.json();
    }

    trackEvent(eventType, data) {
      try {
        // Для кликов используем специальный endpoint
        if (eventType === 'click') {
          const clickBody = JSON.stringify({
            api_key: this.apiKey,
            product_id: data.product_id,
            query: data.query || ''
          });
          
          console.log('[SearchWidget] Tracking click:', data.product_id, 'query:', data.query);
          
          fetch(`${this.apiUrl}/track/click`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: clickBody,
            keepalive: true,
            mode: 'cors',
            credentials: 'omit'
          }).then(r => r.json()).then(res => {
            console.log('[SearchWidget] Click tracked:', res);
          }).catch(err => {
            console.error('[SearchWidget] Click tracking error:', err);
          });
          return;
        }
        
        // Для остальных событий - используем fetch без credentials
        const body = JSON.stringify({
          type: eventType,
          api_key: this.apiKey,
          ...data,
          timestamp: Date.now(),
        });
        
        fetch(`${this.apiUrl}/analytics/event`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: body,
          keepalive: true,
          mode: 'cors',
          credentials: 'omit'
        });
      } catch (e) {
        console.error('[SearchWidget] trackEvent error:', e);
      }
    }
  }

  // ==================== UI компоненты ====================
  
  class SuggestionsDropdown {
    constructor(widget) {
      this.widget = widget;
      this.element = null;
      this.visible = false;
      this.selectedIndex = -1;
    }

    create() {
      this.element = document.createElement('div');
      this.element.className = 'search-widget-suggestions';
      this.element.style.cssText = `
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        background: var(--search-background, #fff);
        border: 1px solid var(--search-border-color, #ddd);
        border-radius: var(--search-border-radius, 8px);
        box-shadow: var(--search-shadow, 0 4px 12px rgba(0,0,0,0.15));
        z-index: ${this.widget.config.zIndex};
        max-height: 400px;
        overflow-y: auto;
        display: none;
        margin-top: 4px;
      `;
      this.widget.inputWrapper.appendChild(this.element);
    }

    show(data) {
      const suggestions = data.suggestions || data;
      const queries = suggestions.queries || [];
      const categories = suggestions.categories || [];
      const products = suggestions.products || [];
      
      if (queries.length === 0 && categories.length === 0 && products.length === 0) {
        this.hide();
        return;
      }

      this.element.innerHTML = this.render({ queries, categories, products });
      this.element.style.display = 'block';
      this.visible = true;
      this.selectedIndex = -1;
      this.bindEvents();
    }

    hide() {
      this.element.style.display = 'none';
      this.visible = false;
      this.selectedIndex = -1;
    }

    render(suggestions) {
      let html = '';

      if (suggestions.queries && suggestions.queries.length > 0) {
        html += '<div class="search-widget-suggestions-section">';
        html += suggestions.queries.map((item, index) => {
          const text = typeof item === 'string' ? item : (item.text || item.query);
          const highlight = typeof item === 'object' ? item.highlight : null;
          const count = typeof item === 'object' ? item.count : null;
          return `
            <div class="search-widget-suggestion-item" data-type="query" data-index="${index}" data-value="${escapeHtml(text)}">
              <svg class="search-widget-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"></circle>
                <path d="m21 21-4.35-4.35"></path>
              </svg>
              <span>${highlight || escapeHtml(text)}</span>
              ${count ? `<span class="search-widget-count">${count}</span>` : ''}
            </div>
          `;
        }).join('');
        html += '</div>';
      }

      if (suggestions.categories && suggestions.categories.length > 0) {
        html += '<div class="search-widget-suggestions-section">';
        html += '<div class="search-widget-section-title">Категории</div>';
        html += suggestions.categories.map(cat => `
          <a href="${cat.url || '#'}" class="search-widget-suggestion-item search-widget-category" data-type="category">
            <svg class="search-widget-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
            </svg>
            <span>${escapeHtml(cat.name)}</span>
            ${cat.count ? `<span class="search-widget-count">${cat.count}</span>` : ''}
          </a>
        `).join('');
        html += '</div>';
      }

      if (suggestions.products && suggestions.products.length > 0) {
        const showImages = this.widget.config.showImages !== false;
        const showPrices = this.widget.config.showPrices !== false;
        
        html += '<div class="search-widget-suggestions-section search-widget-products">';
        html += '<div class="search-widget-section-title">Товары</div>';
        html += suggestions.products.map((product, index) => {
          const image = product.image || product.picture;
          const price = product.price;
          const oldPrice = product.old_price || product.oldPrice;
          return `
            <a href="${product.url || '#'}" class="search-widget-suggestion-item search-widget-product" data-type="product" data-id="${product.id}" data-index="${index}">
              ${showImages && image ? `<img src="${image}" alt="" class="search-widget-product-image" loading="lazy">` : ''}
              <div class="search-widget-product-info">
                <div class="search-widget-product-name">${escapeHtml(product.name)}</div>
                ${showPrices && price ? `<div class="search-widget-product-price">
                  ${oldPrice ? `<span class="search-widget-old-price">${formatPrice(oldPrice, this.widget.config.currency)}</span>` : ''}
                  <span class="search-widget-current-price">${formatPrice(price, this.widget.config.currency)}</span>
                </div>` : ''}
              </div>
            </a>
          `;
        }).join('');
        html += '</div>';
      }

      return html;
    }

    bindEvents() {
      const items = this.element.querySelectorAll('.search-widget-suggestion-item');
      console.log('[SearchWidget] Binding events to', items.length, 'suggestion items');
      
      items.forEach((item, index) => {
        item.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const type = item.dataset.type;
          const value = item.dataset.value;
          console.log('[SearchWidget] Suggestion clicked:', type, value);
          
          if (type === 'query') {
            this.widget.selectSuggestion(value);
          } else if (type === 'product') {
            // Сначала отправляем клик, потом переходим
            this.widget.trackClick(item.dataset.id, index);
            const url = item.dataset.url;
            if (url) {
              // Небольшая задержка чтобы запрос успел отправиться
              setTimeout(() => {
                window.location.href = url;
              }, 50);
            }
          }
        });

        item.addEventListener('mouseenter', () => {
          this.selectedIndex = index;
          this.updateSelection();
        });
      });
    }

    navigate(direction) {
      const items = this.element.querySelectorAll('.search-widget-suggestion-item[data-type="query"]');
      
      if (direction === 'down') {
        this.selectedIndex = Math.min(this.selectedIndex + 1, items.length - 1);
      } else {
        this.selectedIndex = Math.max(this.selectedIndex - 1, -1);
      }
      
      this.updateSelection();
      
      if (this.selectedIndex >= 0 && items[this.selectedIndex]) {
        return items[this.selectedIndex].dataset.value;
      }
      return null;
    }

    updateSelection() {
      const items = this.element.querySelectorAll('.search-widget-suggestion-item');
      items.forEach((item, index) => {
        item.classList.toggle('search-widget-selected', index === this.selectedIndex);
      });
    }
  }

  // ==================== Главный класс виджета ====================
  
  class SearchWidgetClass {
    constructor() {
      this.config = null;
      this.api = null;
      this.input = null;
      this.inputWrapper = null;
      this.suggestions = null;
      this.state = {
        query: '',
        results: [],
        filters: {},
        loading: false,
      };
      this.events = {};
      this.initialized = false;
    }

    init(config) {
      if (this.initialized) {
        console.warn('SearchWidget already initialized');
        return this;
      }

      this.config = { ...DEFAULT_CONFIG, ...config };
      
      if (config.container && !config.selector) {
        this.config.selector = config.container;
      }
      
      if (!this.config.apiKey) {
        console.error('SearchWidget: apiKey is required');
        return this;
      }

      // Загружаем настройки с сервера и применяем
      this.loadServerConfig().then(() => {
        this.initWidget();
      }).catch(err => {
        console.warn('[SearchWidget] Failed to load server config, using defaults:', err);
        this.initWidget();
      });

      return this;
    }

    async loadServerConfig() {
      try {
        const response = await fetch(`${this.config.apiUrl}/widget/${this.config.apiKey}/config`);
        if (response.ok) {
          const serverConfig = await response.json();
          console.log('[SearchWidget] Loaded server config:', serverConfig);
          
          // Применяем настройки с сервера (они имеют приоритет над дефолтными, но не над локальными)
          if (serverConfig.placeholder) this.config.placeholder = serverConfig.placeholder;
          if (serverConfig.theme) this.config.theme = serverConfig.theme;
          if (serverConfig.primaryColor) this.config.primaryColor = serverConfig.primaryColor;
          if (serverConfig.borderRadius !== undefined) this.config.borderRadius = serverConfig.borderRadius;
          if (serverConfig.showImages !== undefined) this.config.showImages = serverConfig.showImages;
          if (serverConfig.showPrices !== undefined) this.config.showPrices = serverConfig.showPrices;
          if (serverConfig.showButton !== undefined) this.config.showButton = serverConfig.showButton;
          if (serverConfig.maxResults) this.config.results.limit = serverConfig.maxResults;
          if (serverConfig.cartCallbackUrl) this.config.cartCallbackUrl = serverConfig.cartCallbackUrl;
        }
      } catch (err) {
        console.warn('[SearchWidget] Error loading config:', err);
      }
    }

    initWidget() {
      const target = typeof this.config.selector === 'string' 
        ? document.querySelector(this.config.selector)
        : this.config.selector;

      if (!target) {
        console.error(`SearchWidget: element not found: ${this.config.selector}`);
        return this;
      }

      if (target.tagName === 'INPUT') {
        this.input = target;
      } else {
        this.input = document.createElement('input');
        this.input.type = 'text';
        this.input.placeholder = this.config.placeholder || 'Поиск товаров...';
        target.appendChild(this.input);
      }

      this.api = new ApiClient(this.config.apiUrl, this.config.apiKey);
      this.createWrapper();
      this.loadCategories(); // fire-and-forget, не блокирует готовность инпута

      this.suggestions = new SuggestionsDropdown(this);
      this.suggestions.create();

      this.bindEvents();

      if (this.config.injectStyles !== false) {
        this.injectStyles();
      }

      this.initialized = true;
      this.emit('init', { config: this.config });

      if (this.config.initialQuery) {
        this.search(this.config.initialQuery);
      }

      return this;
    }

    createWrapper() {
      this.inputWrapper = document.createElement('div');
      this.inputWrapper.className = 'search-widget-wrapper';
      this.inputWrapper.style.position = 'relative';

      this.input.parentNode.insertBefore(this.inputWrapper, this.input);
      this.inputWrapper.appendChild(this.input);

      this.input.classList.add('search-widget-input');

      // Дропдаун "Везде" - выбор категории, в которой ищем (заполняется loadCategories())
      this.categorySelect = document.createElement('select');
      this.categorySelect.className = 'search-widget-category-select';
      this.categorySelect.innerHTML = '<option value="">Везде</option>';
      this.categorySelect.addEventListener('change', () => {
        const value = this.categorySelect.value;
        if (value) {
          this.state.filters.category = [value];
        } else {
          delete this.state.filters.category;
        }
        const query = this.input.value.trim();
        if (query.length >= this.config.minChars) {
          this.search(query);
        }
      });
      this.inputWrapper.insertBefore(this.categorySelect, this.input);

      // Добавляем кнопку поиска если включено
      if (this.config.showButton !== false) {
        this.searchButton = document.createElement('button');
        this.searchButton.type = 'button';
        this.searchButton.className = 'search-widget-button';
        this.searchButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg>';
        this.searchButton.addEventListener('click', () => {
          this.performSearch();
        });
        this.inputWrapper.appendChild(this.searchButton);
        this.inputWrapper.classList.add('has-button');
      }
    }

    async loadCategories() {
      try {
        const data = await this.api.categories();
        const categories = data.categories || [];
        if (!categories.length) return;

        const options = categories.map(c =>
          `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)} (${c.count})</option>`
        ).join('');
        this.categorySelect.innerHTML = '<option value="">Везде</option>' + options;
      } catch (error) {
        console.warn('[SearchWidget] Failed to load categories:', error);
      }
    }

    bindEvents() {
      // При вводе сразу выполняем поиск
      const handleInput = debounce((e) => {
        const query = e.target.value.trim();
        this.state.query = query;

        if (query.length >= this.config.minChars) {
          // Выполняем полноценный поиск вместо подсказок
          this.search(query);
        } else {
          this.suggestions.hide();
          if (this.resultsContainer) {
            this.resultsContainer.remove();
            this.resultsContainer = null;
          }
        }
      }, this.config.debounceMs);

      this.input.addEventListener('input', handleInput);

      this.input.addEventListener('keydown', (e) => {
        if (!this.suggestions.visible) {
          if (e.key === 'Enter') {
            e.preventDefault();
            this.performSearch();
          }
          return;
        }

        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault();
            const nextValue = this.suggestions.navigate('down');
            if (nextValue) this.input.value = nextValue;
            break;
            
          case 'ArrowUp':
            e.preventDefault();
            const prevValue = this.suggestions.navigate('up');
            if (prevValue) this.input.value = prevValue;
            break;
            
          case 'Enter':
            e.preventDefault();
            this.performSearch();
            break;
            
          case 'Escape':
            this.suggestions.hide();
            break;
        }
      });

      document.addEventListener('click', (e) => {
        if (!this.inputWrapper.contains(e.target)) {
          this.suggestions.hide();
        }
      });

      // При фокусе показываем популярные запросы если поле пустое
      this.input.addEventListener('focus', () => {
        const query = this.input.value.trim();
        console.log('[SearchWidget] Focus event, query:', query);
        if (query.length >= this.config.minChars) {
          // Если есть текст - ищем
          this.search(query);
        } else {
          // Если пусто - показываем популярные запросы
          this.fetchPopularQueries();
        }
      });
    }

    async fetchPopularQueries() {
      try {
        console.log('[SearchWidget] Fetching popular queries...');
        const response = await fetch(`${this.config.apiUrl}/popular?limit=5`, {
          headers: {
            'X-API-Key': this.config.apiKey,
            'Content-Type': 'application/json',
          },
        });
        
        if (!response.ok) {
          throw new Error(`Popular failed: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('[SearchWidget] Popular data:', data);
        
        if (data.queries && data.queries.length > 0) {
          const suggestions = {
            queries: data.queries.map(q => ({
              text: q.text,
              highlight: q.text,
              count: q.count,
              isPopular: true
            })),
            categories: [],
            products: []
          };
          this.suggestions.show({ suggestions }, true);
        }
      } catch (error) {
        console.error('[SearchWidget] Failed to fetch popular queries:', error);
      }
    }

    async fetchSuggestions(prefix) {
      try {
        const data = await this.api.suggest(prefix, {
          limit: this.config.suggestions.limit,
        });

        this.suggestions.show(data);
        this.emit('suggest', { prefix, suggestions: data });
        
      } catch (error) {
        console.error('SearchWidget suggest error:', error);
        this.emit('error', { error, context: 'suggest' });
      }
    }

    selectSuggestion(value) {
      console.log('[SearchWidget] selectSuggestion called with:', value);
      this.input.value = value;
      this.state.query = value;
      this.suggestions.hide();
      this.search(value);
    }

    // Явная отправка поиска (Enter / клик по кнопке поиска) - в отличие от
    // ввода-по-мере-печати (handleInput), сразу открывает полный вид
    // результатов с фасетами, а не dropdown-превью
    async performSearch() {
      const query = this.input.value.trim();

      if (!query) return;

      this.suggestions.hide();

      if (this.config.onSearch) {
        this.config.onSearch(query);
        return;
      }

      this.state.query = query;
      this.lastSearchQuery = query;
      await this.showAllResultsPopup(query);
    }

    async search(query, options = {}) {
      try {
        console.log('[SearchWidget] Searching for:', query);
        this.state.loading = true;
        this.state.query = query;
        this.input.value = query;

        const data = await this.api.search(query, {
          limit: this.config.results.limit,
          ...options,
          filters: { ...this.state.filters, ...options.filters },
        });

        console.log('[SearchWidget] Search results:', data.total, 'items');
        
        this.state.results = data.items || data.products || [];
        this.state.loading = false;

        this.emit('search', { query, results: data });

        if (this.config.analytics.enabled) {
          this.api.trackEvent('search', {
            query,
            results_count: data.total || this.state.results.length,
          });
        }

        // Показываем результаты в dropdown или в указанном контейнере
        if (this.config.resultsSelector) {
          this.renderResults(data);
        } else {
          // Показываем результаты в suggestions dropdown
          this.showResultsInDropdown(data);
        }

        return data;

      } catch (error) {
        this.state.loading = false;
        console.error('SearchWidget search error:', error);
        this.emit('error', { error, context: 'search' });
        throw error;
      }
    }

    showResultsInDropdown(data) {
      let items = data.items || data.products || [];
      const total = data.total || items.length;
      console.log('[SearchWidget] Showing', items.length, 'results in dropdown, total:', total);
      
      if (items.length === 0) {
        this.suggestions.element.innerHTML = `
          <div class="search-widget-no-results">
            <p>По запросу "<strong>${escapeHtml(this.state.query)}</strong>" ничего не найдено</p>
          </div>
        `;
        this.suggestions.element.style.display = 'block';
        this.suggestions.visible = true;
        return;
      }

      // Сортировка: сначала в наличии
      items = [...items].sort((a, b) => {
        const aInStock = a.in_stock !== false ? 1 : 0;
        const bInStock = b.in_stock !== false ? 1 : 0;
        return bInStock - aInStock;
      });

      // В dropdown показываем только первые 20 товаров
      const dropdownItems = items.slice(0, 20);
      const hasMore = total > 20;

      let html = `
        <div class="search-widget-results-dropdown">
          <div class="search-widget-results-header">
            Найдено: ${total} товаров
          </div>
          <div class="search-widget-products-list">
      `;

      dropdownItems.forEach((item, index) => {
        const price = item.price ? formatPrice(item.price, this.config.currency) : '';
        const oldPrice = item.old_price ? formatPrice(item.old_price, this.config.currency) : '';
        const inStock = item.in_stock !== false;
        
        html += `
          <a href="${item.url || '#'}" class="search-widget-product-card ${!inStock ? 'out-of-stock' : ''}" data-id="${item.id}" data-index="${index}">
            <div class="search-widget-product-image">
              <img src="${item.image || ''}" alt="${escapeHtml(item.name || '')}" loading="lazy" onerror="this.style.display='none'">
            </div>
            <div class="search-widget-product-info">
              <div class="search-widget-product-name">${escapeHtml(item.name || '')}</div>
              <div class="search-widget-product-price">
                ${oldPrice ? `<span class="old-price">${oldPrice}</span>` : ''}
                <span class="current-price">${price}</span>
              </div>
              ${!inStock ? '<div class="search-widget-out-of-stock">Нет в наличии</div>' : ''}
            </div>
          </a>
        `;
      });

      html += '</div>';
      
      // Кнопка "Показать все"
      if (hasMore) {
        html += `
          <div class="search-widget-show-all">
            <button class="search-widget-show-all-btn" data-query="${escapeHtml(this.state.query)}" data-total="${total}">
              Показать все ${total} товаров
            </button>
          </div>
        `;
      }
      
      html += '</div>';

      this.suggestions.element.innerHTML = html;
      this.suggestions.element.style.display = 'block';
      this.suggestions.visible = true;
      
      // Сохраняем запрос для popup
      this.lastSearchQuery = this.state.query;
      this.lastSearchTotal = total;
      
      // Привязываем событие на кнопку "Показать все"
      const showAllBtn = this.suggestions.element.querySelector('.search-widget-show-all-btn');
      if (showAllBtn) {
        showAllBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.showAllResultsPopup();
        });
      }
    }

    async showAllResultsPopup(query) {
      query = query || this.lastSearchQuery;
      if (!query) return;

      this.suggestions.hide();

      // Состояние текущего открытия результатов - отдельно от dropdown/scope-фильтра сверху,
      // но стартует с тех же фильтров (например, если сверху уже выбрана категория)
      this.popupState = {
        query,
        filters: { ...this.state.filters },
        sort: 'relevance',
        mode: 'grouped', // 'grouped' - секции по категориям, 'category' - плоская пагинация по одной категории
        categoryName: null,
        page: 1,
        itemsPerPage: 20,
      };
      this.popupItemsById = {};

      const popup = document.createElement('div');
      popup.className = 'search-widget-popup-overlay';
      popup.innerHTML = `
        <div class="search-widget-popup search-widget-popup-faceted">
          <div class="search-widget-popup-header">
            <h3>Результаты поиска: "${escapeHtml(query)}"</h3>
            <span class="search-widget-popup-count" id="search-popup-count">Загрузка...</span>
            <button class="search-widget-popup-close">&times;</button>
          </div>
          <div class="search-widget-popup-body">
            <aside class="search-widget-facets-sidebar" id="search-popup-sidebar"></aside>
            <main class="search-widget-results-main">
              <div class="search-widget-popup-loading">Загрузка товаров...</div>
              <div id="search-popup-main-content"></div>
            </main>
          </div>
        </div>
      `;

      document.body.appendChild(popup);
      this.popupEl = popup;

      // Закрытие popup - все три пути закрытия должны снимать escHandler,
      // иначе он остаётся висеть на document навсегда (была такая утечка)
      const closePopup = () => {
        document.removeEventListener('keydown', escHandler);
        popup.remove();
        this.popupEl = null;
      };
      const escHandler = (e) => {
        if (e.key === 'Escape') closePopup();
      };

      popup.querySelector('.search-widget-popup-close').addEventListener('click', closePopup);
      popup.addEventListener('click', (e) => {
        if (e.target === popup) closePopup();
      });
      document.addEventListener('keydown', escHandler);

      await this.refreshPopupResults();
    }

    // Перезапрашивает результаты с текущим состоянием popupState (фильтры/сортировка/режим)
    // и перерисовывает и сайдбар, и основной контент
    async refreshPopupResults() {
      if (!this.popupEl) return;
      const state = this.popupState;

      const loadingEl = this.popupEl.querySelector('.search-widget-popup-loading');
      if (loadingEl) loadingEl.style.display = 'block';

      try {
        const isCategoryMode = state.mode === 'category';
        const filters = isCategoryMode
          ? { ...state.filters, category: [state.categoryName] }
          : state.filters;

        const data = await this.api.search(state.query, {
          limit: isCategoryMode ? state.itemsPerPage : 500,
          offset: isCategoryMode ? (state.page - 1) * state.itemsPerPage : 0,
          facets: true,
          sort: state.sort,
          filters,
        });

        this.popupItemsById = {};
        (data.items || []).forEach(item => { this.popupItemsById[item.id] = item; });

        const countEl = this.popupEl.querySelector('#search-popup-count');
        if (countEl) countEl.textContent = `Найдено: ${data.total || 0} товаров`;

        if (loadingEl) loadingEl.remove();

        this.renderFacetsSidebar(data.facets || {});
        this.renderPopupMain(data);

      } catch (error) {
        console.error('[SearchWidget] Failed to load results:', error);
        if (loadingEl) loadingEl.textContent = 'Ошибка загрузки товаров';
      }
    }

    renderFacetsSidebar(facets) {
      const sidebar = this.popupEl?.querySelector('#search-popup-sidebar');
      if (!sidebar) return;
      const state = this.popupState;

      let html = `
        <div class="search-widget-facet-group">
          <label class="search-widget-facet-title">Сортировать по</label>
          <select class="search-widget-sort-select">
            <option value="relevance" ${state.sort === 'relevance' ? 'selected' : ''}>Релевантности</option>
            <option value="price_asc" ${state.sort === 'price_asc' ? 'selected' : ''}>Цене (сначала дешёвые)</option>
            <option value="price_desc" ${state.sort === 'price_desc' ? 'selected' : ''}>Цене (сначала дорогие)</option>
          </select>
        </div>
      `;

      if (facets.categories && facets.categories.length) {
        const selected = state.filters.category || [];
        html += `
          <div class="search-widget-facet-group">
            <div class="search-widget-facet-title">Категория</div>
            ${facets.categories.map(c => `
              <label class="search-widget-facet-checkbox-row">
                <input type="checkbox" data-facet="category" value="${escapeHtml(c.value)}" ${selected.includes(c.value) ? 'checked' : ''}>
                <span>${escapeHtml(c.value)} <em>${c.count}</em></span>
              </label>
            `).join('')}
          </div>
        `;
      }

      if (facets.price) {
        const min = facets.price.min ?? 0;
        const max = facets.price.max ?? 0;
        const curMin = state.filters.min_price ?? min;
        const curMax = state.filters.max_price ?? max;
        html += `
          <div class="search-widget-facet-group">
            <div class="search-widget-facet-title">Цена</div>
            <div class="search-widget-price-range">
              <input type="number" class="search-widget-price-min" min="${min}" max="${max}" value="${curMin}">
              <span>–</span>
              <input type="number" class="search-widget-price-max" min="${min}" max="${max}" value="${curMax}">
            </div>
            <button type="button" class="search-widget-price-apply">Применить</button>
          </div>
        `;
      }

      if (facets.params) {
        for (const [name, values] of Object.entries(facets.params)) {
          if (!values || !values.length) continue;
          const selected = (state.filters.params || {})[name] || [];
          html += `
            <div class="search-widget-facet-group">
              <div class="search-widget-facet-title">${escapeHtml(name)}</div>
              ${values.map(v => `
                <label class="search-widget-facet-checkbox-row">
                  <input type="checkbox" data-facet="params.${escapeHtml(name)}" value="${escapeHtml(v.value)}" ${selected.includes(v.value) ? 'checked' : ''}>
                  <span>${escapeHtml(v.value)} <em>${v.count}</em></span>
                </label>
              `).join('')}
            </div>
          `;
        }
      }

      sidebar.innerHTML = html;

      const sortSelect = sidebar.querySelector('.search-widget-sort-select');
      sortSelect?.addEventListener('change', () => {
        state.sort = sortSelect.value;
        this.refreshPopupResults();
      });

      sidebar.querySelectorAll('input[type="checkbox"][data-facet]').forEach(cb => {
        cb.addEventListener('change', () => {
          const facetKey = cb.dataset.facet;
          const value = cb.value;

          if (facetKey === 'category') {
            const list = new Set(state.filters.category || []);
            cb.checked ? list.add(value) : list.delete(value);
            if (list.size) state.filters.category = [...list];
            else delete state.filters.category;
          } else if (facetKey.startsWith('params.')) {
            const paramName = facetKey.slice(7);
            state.filters.params = state.filters.params || {};
            const list = new Set(state.filters.params[paramName] || []);
            cb.checked ? list.add(value) : list.delete(value);
            if (list.size) state.filters.params[paramName] = [...list];
            else delete state.filters.params[paramName];
          }

          state.mode = 'grouped';
          state.page = 1;
          this.refreshPopupResults();
        });
      });

      const priceApply = sidebar.querySelector('.search-widget-price-apply');
      priceApply?.addEventListener('click', () => {
        const minVal = parseFloat(sidebar.querySelector('.search-widget-price-min').value);
        const maxVal = parseFloat(sidebar.querySelector('.search-widget-price-max').value);
        if (!isNaN(minVal)) state.filters.min_price = minVal; else delete state.filters.min_price;
        if (!isNaN(maxVal)) state.filters.max_price = maxVal; else delete state.filters.max_price;
        state.mode = 'grouped';
        state.page = 1;
        this.refreshPopupResults();
      });
    }

    renderPopupMain(data) {
      const container = this.popupEl?.querySelector('#search-popup-main-content');
      if (!container) return;

      const items = data.items || data.products || [];

      if (items.length === 0) {
        container.innerHTML = this.renderNoResults(this.popupState.query);
        return;
      }

      if (this.popupState.mode === 'category') {
        this.renderCategoryGrid(container, items, data.total || items.length);
      } else {
        this.renderGroupedResults(container, items, data.facets || {});
      }
    }

    renderGroupedResults(container, items, facets) {
      const categoryCounts = {};
      (facets.categories || []).forEach(c => { categoryCounts[c.value] = c.count; });

      const groups = new Map();
      items.forEach(item => {
        const cat = item.category || 'Без категории';
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat).push(item);
      });

      let html = '';
      for (const [category, groupItems] of groups.entries()) {
        const total = categoryCounts[category] ?? groupItems.length;
        const preview = groupItems.slice(0, 8);
        html += `
          <section class="search-widget-category-section">
            <div class="search-widget-category-section-header">
              <h4>${escapeHtml(category)}</h4>
              <span class="search-widget-category-count">${total}</span>
            </div>
            <div class="search-widget-category-grid">
              ${preview.map(p => this.renderCard(p, { compact: true })).join('')}
            </div>
            ${total > preview.length ? `
              <button type="button" class="search-widget-show-category-btn" data-category="${escapeHtml(category)}">
                Показать все ${total} →
              </button>
            ` : ''}
          </section>
        `;
      }

      container.innerHTML = html;
      this.bindCardEvents(container);

      container.querySelectorAll('.search-widget-show-category-btn').forEach(btn => {
        btn.addEventListener('click', () => this.showCategoryGrid(btn.dataset.category));
      });
    }

    showCategoryGrid(categoryName) {
      this.popupState.mode = 'category';
      this.popupState.categoryName = categoryName;
      this.popupState.page = 1;
      this.refreshPopupResults();
    }

    renderCategoryGrid(container, items, total) {
      const state = this.popupState;
      const totalPages = Math.ceil(total / state.itemsPerPage);

      let html = `
        <div class="search-widget-category-grid-header">
          <button type="button" class="search-widget-back-btn">← Ко всем категориям</button>
          <h4>${escapeHtml(state.categoryName)} (${total})</h4>
        </div>
        <div class="search-widget-popup-grid">
          ${items.map(p => this.renderCard(p, { compact: false })).join('')}
        </div>
      `;

      if (totalPages > 1) {
        html += '<div class="search-widget-pagination-buttons">';
        html += `<button class="search-widget-page-btn" data-page="prev" ${state.page === 1 ? 'disabled' : ''}>←</button>`;
        for (let i = 1; i <= totalPages; i++) {
          if (i === 1 || i === totalPages || (i >= state.page - 2 && i <= state.page + 2)) {
            html += `<button class="search-widget-page-btn ${i === state.page ? 'active' : ''}" data-page="${i}">${i}</button>`;
          } else if (i === state.page - 3 || i === state.page + 3) {
            html += '<span class="search-widget-page-dots">...</span>';
          }
        }
        html += `<button class="search-widget-page-btn" data-page="next" ${state.page === totalPages ? 'disabled' : ''}>→</button>`;
        html += '</div>';
      }

      container.innerHTML = html;
      this.bindCardEvents(container);

      container.querySelector('.search-widget-back-btn')?.addEventListener('click', () => {
        state.mode = 'grouped';
        state.categoryName = null;
        this.refreshPopupResults();
      });

      container.querySelectorAll('.search-widget-page-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const page = btn.dataset.page;
          if (page === 'prev' && state.page > 1) state.page--;
          else if (page === 'next' && state.page < totalPages) state.page++;
          else if (page !== 'prev' && page !== 'next') state.page = parseInt(page, 10);
          this.refreshPopupResults();
        });
      });
    }

    // Общая карточка товара для нового вида результатов (секции по категориям +
    // плоская сетка одной категории) - со степпером количества и кнопкой "В корзину".
    // Не используется в dropdown-подсказках и в renderProductCard() (custom-container
    // режим с config.templates.productCard) - это отдельные, уже работающие шаблоны.
    renderCard(product, opts = {}) {
      const showImages = this.config.showImages !== false;
      const showPrices = this.config.showPrices !== false;
      const price = product.price ? formatPrice(product.price, this.config.currency) : '';
      const oldPrice = product.old_price ? formatPrice(product.old_price, this.config.currency) : '';
      const inStock = product.in_stock !== false;
      const compactClass = opts.compact ? 'search-widget-facet-card-compact' : '';

      return `
        <div class="search-widget-facet-card ${compactClass} ${!inStock ? 'out-of-stock' : ''}" data-id="${escapeHtml(String(product.id))}">
          <a href="${product.url || '#'}">
            ${showImages ? `<div class="search-widget-facet-card-image">
              <img src="${product.image || ''}" alt="${escapeHtml(product.name || '')}" loading="lazy" onerror="this.style.display='none'">
            </div>` : ''}
            <div class="search-widget-facet-card-info">
              <div class="search-widget-facet-card-name">${escapeHtml(product.name || '')}</div>
              ${showPrices && price ? `<div class="search-widget-facet-card-price">
                ${oldPrice ? `<span class="old-price">${oldPrice}</span>` : ''}
                <span class="current-price">${price}</span>
              </div>` : ''}
              ${!inStock ? '<div class="search-widget-out-of-stock">Нет в наличии</div>' : ''}
            </div>
          </a>
          ${inStock ? `
            <div class="search-widget-cart-row">
              <div class="search-widget-qty-stepper">
                <button type="button" class="qty-minus">−</button>
                <input type="number" class="qty-input" min="1" value="1">
                <button type="button" class="qty-plus">+</button>
              </div>
              <button type="button" class="search-widget-add-to-cart-btn">В корзину</button>
            </div>
          ` : ''}
        </div>
      `;
    }

    bindCardEvents(container) {
      container.querySelectorAll('.search-widget-facet-card').forEach((card, index) => {
        const productId = card.dataset.id;

        const link = card.querySelector('a');
        link?.addEventListener('click', (e) => {
          e.preventDefault();
          this.trackClick(productId, index);
          if (link.href) {
            setTimeout(() => { window.location.href = link.href; }, 50);
          }
        });

        const qtyInput = card.querySelector('.qty-input');
        card.querySelector('.qty-minus')?.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (qtyInput) qtyInput.value = Math.max(1, (parseInt(qtyInput.value, 10) || 1) - 1);
        });
        card.querySelector('.qty-plus')?.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (qtyInput) qtyInput.value = (parseInt(qtyInput.value, 10) || 1) + 1;
        });

        const cartBtn = card.querySelector('.search-widget-add-to-cart-btn');
        cartBtn?.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const quantity = Math.max(1, parseInt(qtyInput?.value, 10) || 1);
          const product = this.popupItemsById[productId] || { id: productId };
          this.addToCart(product, quantity, cartBtn);
        });
      });
    }

    // POSTит в cartCallbackUrl проекта (настраивается в личном кабинете). Если колбэк
    // не настроен - тихий no-op с предупреждением в консоль, аналитика "добавления в
    // корзину" всё равно фиксируется через trackAddToCart.
    async addToCart(product, quantity, buttonEl) {
      this.trackAddToCart({ product_id: product.id, quantity });

      if (!this.config.cartCallbackUrl) {
        console.warn('[SearchWidget] cartCallbackUrl is not configured - "В корзину" is a no-op. ' +
          'Set it in project widget settings, or handle the "addToCart" event instead.');
        return;
      }

      const originalText = buttonEl.textContent;
      buttonEl.disabled = true;

      const payload = {
        apiKey: this.config.apiKey,
        productId: product.id,
        quantity,
        product: {
          id: product.id,
          name: product.name,
          price: product.price,
          url: product.url,
          params: product.params || {},
        },
      };

      try {
        const response = await this.api.postCart(this.config.cartCallbackUrl, payload);
        if (!response.ok) {
          throw new Error(`Cart callback failed: ${response.status}`);
        }
        buttonEl.textContent = 'Добавлено ✓';
        buttonEl.classList.add('search-widget-cart-success');
        setTimeout(() => {
          buttonEl.textContent = originalText;
          buttonEl.classList.remove('search-widget-cart-success');
          buttonEl.disabled = false;
        }, 1500);
      } catch (error) {
        console.error('[SearchWidget] addToCart error:', error);
        buttonEl.textContent = 'Не удалось добавить';
        buttonEl.classList.add('search-widget-cart-error');
        setTimeout(() => {
          buttonEl.textContent = originalText;
          buttonEl.classList.remove('search-widget-cart-error');
          buttonEl.disabled = false;
        }, 1500);
      }
    }

    renderResults(data) {
      const container = document.querySelector(this.config.resultsSelector);
      if (!container) return;

      const items = data.items || data.products || [];
      
      if (items.length === 0) {
        container.innerHTML = this.renderNoResults(this.state.query);
        return;
      }

      let html = `
        <div class="search-widget-results">
          <div class="search-widget-results-header">
            <span>Найдено: ${data.total || items.length}</span>
          </div>
          <div class="search-widget-results-grid">
            ${items.map((product, index) => this.renderProductCard(product, index)).join('')}
          </div>
        </div>
      `;

      container.innerHTML = html;

      container.querySelectorAll('.search-widget-result-card').forEach((card, index) => {
        card.addEventListener('click', (e) => {
          // Предотвращаем переход по ссылке
          e.preventDefault();
          
          // Сначала отправляем клик
          this.trackClick(card.dataset.id, index);
          
          // Потом переходим по ссылке
          const link = card.querySelector('a');
          if (link && link.href) {
            setTimeout(() => {
              window.location.href = link.href;
            }, 50);
          }
        });
      });
    }

    renderProductCard(product, index) {
      const template = this.config.templates?.productCard;
      if (template) {
        return template(product);
      }

      const showImages = this.config.showImages !== false;
      const showPrices = this.config.showPrices !== false;
      const image = product.image || product.picture;
      const oldPrice = product.old_price || product.oldPrice;
      const inStock = product.in_stock !== false && product.available !== false;

      return `
        <div class="search-widget-result-card" data-id="${product.id}">
          <a href="${product.url || '#'}">
            ${showImages && image ? `<img src="${image}" alt="${escapeHtml(product.name)}" loading="lazy">` : ''}
            <div class="search-widget-result-info">
              <h3>${product.attributes?._highlighted_name || escapeHtml(product.name)}</h3>
              ${showPrices && product.price ? `<div class="search-widget-result-price">
                ${oldPrice ? `<span class="old">${formatPrice(oldPrice, this.config.currency)}</span>` : ''}
                <span class="current">${formatPrice(product.price, this.config.currency)}</span>
              </div>` : ''}
              ${inStock 
                ? '<span class="search-widget-in-stock">В наличии</span>' 
                : '<span class="search-widget-out-of-stock">Нет в наличии</span>'}
            </div>
          </a>
        </div>
      `;
    }

    renderNoResults(query) {
      const template = this.config.templates?.noResults;
      if (template) {
        return template(query);
      }

      return `
        <div class="search-widget-no-results">
          <h3>По запросу "${escapeHtml(query)}" ничего не найдено</h3>
          <p>Попробуйте изменить запрос</p>
        </div>
      `;
    }

    trackClick(productId, position) {
      if (this.config.analytics.enabled && this.config.analytics.trackClicks) {
        this.api.trackEvent('click', {
          query: this.state.query,
          product_id: productId,
          position: position,
        });
      }
      this.emit('click', { productId, position, query: this.state.query });
    }

    trackConversion(data) {
      if (this.config.analytics.enabled && this.config.analytics.trackConversions) {
        this.api.trackEvent('conversion', {
          ...data,
          search_query: this.state.query,
        });
      }
    }

    trackAddToCart(data) {
      if (this.config.analytics.enabled) {
        this.api.trackEvent('add_to_cart', {
          ...data,
          search_query: this.state.query,
        });
      }
      this.emit('addToCart', data);
    }

    clear() {
      this.input.value = '';
      this.state.query = '';
      this.state.results = [];
      this.suggestions.hide();
    }

    closeSuggestions() {
      this.suggestions.hide();
    }

    setConfig(newConfig) {
      this.config = { ...this.config, ...newConfig };
    }

    getState() {
      return { ...this.state };
    }

    destroy() {
      if (this.suggestions && this.suggestions.element) {
        this.suggestions.element.remove();
      }
      
      if (this.inputWrapper && this.input) {
        this.inputWrapper.parentNode.insertBefore(this.input, this.inputWrapper);
        this.inputWrapper.remove();
      }

      this.initialized = false;
    }

    on(event, handler) {
      if (!this.events[event]) {
        this.events[event] = [];
      }
      this.events[event].push(handler);
      return this;
    }

    off(event, handler) {
      if (!this.events[event]) return this;
      this.events[event] = this.events[event].filter(h => h !== handler);
      return this;
    }

    emit(event, data) {
      if (!this.events[event]) return;
      this.events[event].forEach(handler => handler(data));
    }

    injectStyles() {
      if (document.getElementById('search-widget-styles')) return;

      // Получаем настройки из конфига
      const primaryColor = this.config.primaryColor || '#007bff';
      const borderRadius = this.config.borderRadius !== undefined ? this.config.borderRadius + 'px' : '8px';

      const styles = document.createElement('style');
      styles.id = 'search-widget-styles';
      styles.textContent = `
        :root {
          --search-primary-color: ${primaryColor};
          --search-text-color: #333;
          --search-background: #fff;
          --search-border-color: #ddd;
          --search-highlight-color: #fff3cd;
          --search-border-radius: ${borderRadius};
          --search-font-size: 14px;
          --search-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }

        .search-widget-wrapper {
          position: relative;
          display: flex;
          align-items: stretch;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: var(--search-font-size);
        }

        .search-widget-input {
          flex: 1;
          min-width: 0;
          padding: 12px 16px;
          border: 1px solid var(--search-border-color);
          border-radius: var(--search-border-radius);
          border-top-left-radius: 0;
          border-bottom-left-radius: 0;
          font-size: var(--search-font-size);
          outline: none;
          transition: border-color 0.2s;
          box-sizing: border-box;
        }

        .search-widget-input:focus {
          border-color: var(--search-primary-color);
        }

        .search-widget-wrapper.has-button .search-widget-input {
          padding-right: 50px;
        }

        .search-widget-button {
          position: absolute;
          right: 4px;
          top: 50%;
          transform: translateY(-50%);
          width: 40px;
          height: 40px;
          background: var(--search-primary-color);
          border: none;
          border-radius: calc(var(--search-border-radius) - 2px);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          transition: background-color 0.2s;
        }

        .search-widget-button:hover {
          filter: brightness(1.1);
        }

        .search-widget-button svg {
          width: 20px;
          height: 20px;
        }

        .search-widget-suggestions {
          font-size: var(--search-font-size);
        }

        .search-widget-suggestions-section {
          padding: 8px 0;
          border-bottom: 1px solid var(--search-border-color);
        }

        .search-widget-suggestions-section:last-child {
          border-bottom: none;
        }

        .search-widget-section-title {
          padding: 4px 16px;
          font-size: 12px;
          color: #666;
          text-transform: uppercase;
        }

        .search-widget-suggestion-item {
          display: flex;
          align-items: center;
          padding: 10px 16px;
          cursor: pointer;
          transition: background 0.1s;
          text-decoration: none;
          color: var(--search-text-color);
        }

        .search-widget-suggestion-item:hover,
        .search-widget-suggestion-item.search-widget-selected {
          background: #f5f5f5;
        }

        .search-widget-icon {
          margin-right: 12px;
          color: #999;
          flex-shrink: 0;
        }

        .search-widget-count {
          margin-left: auto;
          color: #999;
          font-size: 12px;
        }

        .search-widget-suggestion-item em {
          font-style: normal;
          font-weight: bold;
          background: var(--search-highlight-color);
        }

        .search-widget-product {
          align-items: flex-start;
        }

        .search-widget-product-image {
          width: 50px;
          height: 50px;
          object-fit: contain;
          margin-right: 12px;
          border-radius: 4px;
          flex-shrink: 0;
        }

        .search-widget-product-info {
          flex: 1;
          min-width: 0;
        }

        .search-widget-product-name {
          font-weight: 500;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .search-widget-product-price {
          margin-top: 4px;
        }

        .search-widget-old-price {
          text-decoration: line-through;
          color: #999;
          margin-right: 8px;
        }

        .search-widget-current-price {
          font-weight: bold;
          color: var(--search-primary-color);
        }

        .search-widget-results {
          padding: 20px 0;
        }

        .search-widget-results-header {
          margin-bottom: 16px;
          color: #666;
        }

        .search-widget-results-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 20px;
        }

        .search-widget-result-card {
          border: 1px solid var(--search-border-color);
          border-radius: var(--search-border-radius);
          overflow: hidden;
          transition: box-shadow 0.2s;
        }

        .search-widget-result-card:hover {
          box-shadow: var(--search-shadow);
        }

        .search-widget-result-card a {
          text-decoration: none;
          color: var(--search-text-color);
          display: block;
        }

        .search-widget-result-card img {
          width: 100%;
          height: 200px;
          object-fit: contain;
          background: #f9f9f9;
        }

        .search-widget-result-info {
          padding: 12px;
        }

        .search-widget-result-info h3 {
          margin: 0 0 8px;
          font-size: 14px;
          font-weight: 500;
          line-height: 1.4;
        }

        .search-widget-result-info h3 em {
          font-style: normal;
          background: var(--search-highlight-color);
        }

        .search-widget-result-price .old {
          text-decoration: line-through;
          color: #999;
          margin-right: 8px;
        }

        .search-widget-result-price .current {
          font-weight: bold;
          color: var(--search-primary-color);
        }

        .search-widget-in-stock {
          display: inline-block;
          margin-top: 8px;
          font-size: 12px;
          color: #28a745;
        }

        .search-widget-out-of-stock {
          display: inline-block;
          margin-top: 8px;
          font-size: 12px;
          color: #dc3545;
        }

        .search-widget-no-results {
          text-align: center;
          padding: 40px 20px;
          color: #666;
        }

        .search-widget-no-results h3 {
          margin: 0 0 8px;
          color: var(--search-text-color);
        }

        /* Results in dropdown */
        .search-widget-results-dropdown {
          padding: 0;
        }

        .search-widget-results-dropdown .search-widget-results-header {
          padding: 12px 16px;
          font-size: 13px;
          color: #666;
          background: #f9f9f9;
          border-bottom: 1px solid var(--search-border-color);
        }

        .search-widget-products-list {
          max-height: none;
        }

        .search-widget-product-card {
          display: flex;
          align-items: center;
          padding: 12px 16px;
          text-decoration: none;
          color: var(--search-text-color);
          border-bottom: 1px solid #f0f0f0;
          transition: background 0.1s;
        }

        .search-widget-product-card:hover {
          background: #f5f5f5;
        }

        .search-widget-product-card:last-child {
          border-bottom: none;
        }

        .search-widget-product-card.out-of-stock {
          opacity: 0.6;
        }

        .search-widget-product-card .search-widget-product-image {
          width: 60px;
          height: 60px;
          margin-right: 12px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .search-widget-product-card .search-widget-product-image img {
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
        }

        .search-widget-product-card .search-widget-product-info {
          flex: 1;
          min-width: 0;
        }

        .search-widget-product-card .search-widget-product-name {
          font-size: 14px;
          font-weight: 500;
          margin-bottom: 4px;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .search-widget-product-card .search-widget-product-price {
          font-size: 14px;
        }

        .search-widget-product-card .old-price {
          text-decoration: line-through;
          color: #999;
          margin-right: 8px;
          font-size: 12px;
        }

        .search-widget-product-card .current-price {
          font-weight: bold;
          color: var(--search-primary-color);
        }

        .search-widget-product-card .search-widget-out-of-stock {
          font-size: 11px;
          color: #dc3545;
          margin-top: 2px;
        }

        /* Show all button */
        .search-widget-show-all {
          padding: 12px 16px;
          background: #f9f9f9;
          border-top: 1px solid var(--search-border-color);
        }

        .search-widget-show-all-btn {
          width: 100%;
          padding: 12px 20px;
          background: var(--search-primary-color);
          color: #fff;
          border: none;
          border-radius: var(--search-border-radius);
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.2s;
        }

        .search-widget-show-all-btn:hover {
          background: #0056b3;
        }

        /* Popup overlay */
        .search-widget-popup-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.6);
          z-index: 10000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }

        .search-widget-popup {
          background: #fff;
          border-radius: 12px;
          width: 100%;
          max-width: 900px;
          max-height: 90vh;
          display: flex;
          flex-direction: column;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        }

        .search-widget-popup-faceted {
          max-width: 1100px;
        }

        .search-widget-popup-header {
          display: flex;
          align-items: center;
          padding: 16px 20px;
          border-bottom: 1px solid var(--search-border-color);
          flex-shrink: 0;
        }

        .search-widget-popup-header h3 {
          margin: 0;
          font-size: 18px;
          flex: 1;
        }

        .search-widget-popup-count {
          color: #666;
          font-size: 14px;
          margin-right: 16px;
        }

        .search-widget-popup-close {
          background: none;
          border: none;
          font-size: 28px;
          cursor: pointer;
          color: #999;
          padding: 0;
          line-height: 1;
          transition: color 0.2s;
        }

        .search-widget-popup-close:hover {
          color: #333;
        }

        .search-widget-popup-body {
          flex: 1;
          overflow: hidden;
          display: flex;
          gap: 20px;
          padding: 20px;
        }

        .search-widget-facets-sidebar {
          width: 220px;
          flex-shrink: 0;
          overflow-y: auto;
        }

        .search-widget-results-main {
          flex: 1;
          overflow-y: auto;
          min-width: 0;
        }

        .search-widget-facet-group {
          margin-bottom: 20px;
          padding-bottom: 16px;
          border-bottom: 1px solid var(--search-border-color);
        }

        .search-widget-facet-group:last-child {
          border-bottom: none;
        }

        .search-widget-facet-title {
          display: block;
          font-weight: 600;
          font-size: 13px;
          margin-bottom: 8px;
          color: var(--search-text-color);
        }

        .search-widget-sort-select,
        .search-widget-category-select {
          width: 100%;
          padding: 8px 10px;
          border: 1px solid var(--search-border-color);
          border-radius: 6px;
          font-size: 13px;
          background: #fff;
        }

        .search-widget-category-select {
          width: auto;
          flex-shrink: 0;
          border-right: none;
          border-top-right-radius: 0;
          border-bottom-right-radius: 0;
        }

        .search-widget-facet-checkbox-row {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 0;
          font-size: 13px;
          cursor: pointer;
        }

        .search-widget-facet-checkbox-row input {
          flex-shrink: 0;
        }

        .search-widget-facet-checkbox-row span {
          flex: 1;
          display: flex;
          justify-content: space-between;
          gap: 8px;
        }

        .search-widget-facet-checkbox-row em {
          font-style: normal;
          color: #999;
        }

        .search-widget-price-range {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 8px;
        }

        .search-widget-price-range input {
          width: 0;
          flex: 1;
          padding: 6px 8px;
          border: 1px solid var(--search-border-color);
          border-radius: 6px;
          font-size: 13px;
        }

        .search-widget-price-apply {
          width: 100%;
          padding: 6px;
          background: var(--search-primary-color);
          color: #fff;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
        }

        .search-widget-category-section {
          margin-bottom: 28px;
        }

        .search-widget-category-section-header {
          display: flex;
          align-items: baseline;
          gap: 8px;
          margin-bottom: 12px;
          padding-bottom: 6px;
          border-bottom: 2px solid var(--search-text-color);
        }

        .search-widget-category-section-header h4 {
          margin: 0;
          font-size: 15px;
        }

        .search-widget-category-count {
          color: #999;
          font-size: 13px;
        }

        .search-widget-category-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
          gap: 14px;
        }

        .search-widget-show-category-btn {
          margin-top: 10px;
          background: none;
          border: none;
          color: var(--search-primary-color);
          font-size: 13px;
          cursor: pointer;
          padding: 0;
        }

        .search-widget-category-grid-header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 16px;
        }

        .search-widget-category-grid-header h4 {
          margin: 0;
          font-size: 16px;
        }

        .search-widget-back-btn {
          background: none;
          border: 1px solid var(--search-border-color);
          border-radius: 6px;
          padding: 6px 10px;
          cursor: pointer;
          font-size: 13px;
        }

        .search-widget-facet-card {
          display: flex;
          flex-direction: column;
          border: 1px solid #eee;
          border-radius: 8px;
          overflow: hidden;
          transition: box-shadow 0.2s, transform 0.2s;
        }

        .search-widget-facet-card:hover {
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
          transform: translateY(-2px);
        }

        .search-widget-facet-card.out-of-stock {
          opacity: 0.6;
        }

        .search-widget-facet-card a {
          text-decoration: none;
          color: var(--search-text-color);
        }

        .search-widget-facet-card-image {
          height: 140px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #f9f9f9;
          padding: 10px;
        }

        .search-widget-facet-card-compact .search-widget-facet-card-image {
          height: 110px;
        }

        .search-widget-facet-card-image img {
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
        }

        .search-widget-facet-card-info {
          padding: 10px 12px;
        }

        .search-widget-facet-card-name {
          font-size: 13px;
          font-weight: 500;
          margin-bottom: 6px;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          line-height: 1.3;
        }

        .search-widget-facet-card-price {
          font-size: 14px;
        }

        .search-widget-facet-card-price .old-price {
          text-decoration: line-through;
          color: #999;
          margin-right: 6px;
          font-size: 12px;
        }

        .search-widget-facet-card-price .current-price {
          font-weight: bold;
          color: var(--search-primary-color);
        }

        .search-widget-cart-row {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 12px 12px;
        }

        .search-widget-qty-stepper {
          display: flex;
          align-items: center;
          border: 1px solid var(--search-border-color);
          border-radius: 6px;
          flex-shrink: 0;
        }

        .search-widget-qty-stepper button {
          width: 26px;
          height: 26px;
          background: none;
          border: none;
          cursor: pointer;
          font-size: 14px;
          line-height: 1;
        }

        .search-widget-qty-stepper .qty-input {
          width: 30px;
          border: none;
          text-align: center;
          font-size: 13px;
          -moz-appearance: textfield;
        }

        .search-widget-qty-stepper .qty-input::-webkit-outer-spin-button,
        .search-widget-qty-stepper .qty-input::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }

        .search-widget-add-to-cart-btn {
          flex: 1;
          padding: 6px 8px;
          background: var(--search-primary-color);
          color: #fff;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 12px;
          transition: background-color 0.2s;
        }

        .search-widget-add-to-cart-btn:hover:not(:disabled) {
          filter: brightness(1.1);
        }

        .search-widget-add-to-cart-btn:disabled {
          cursor: default;
        }

        .search-widget-add-to-cart-btn.search-widget-cart-success {
          background: #16a34a;
        }

        .search-widget-add-to-cart-btn.search-widget-cart-error {
          background: #dc2626;
        }

        .search-widget-popup-loading {
          text-align: center;
          padding: 40px;
          color: #666;
          font-size: 16px;
        }

        .search-widget-popup-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 16px;
        }

        .search-widget-popup-card {
          display: flex;
          flex-direction: column;
          text-decoration: none;
          color: var(--search-text-color);
          border: 1px solid #eee;
          border-radius: 8px;
          overflow: hidden;
          transition: box-shadow 0.2s, transform 0.2s;
        }

        .search-widget-popup-card:hover {
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
          transform: translateY(-2px);
        }

        .search-widget-popup-card.out-of-stock {
          opacity: 0.6;
        }

        .search-widget-popup-card-image {
          height: 150px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #f9f9f9;
          padding: 10px;
        }

        .search-widget-popup-card-image img {
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
        }

        .search-widget-popup-card-info {
          padding: 12px;
        }

        .search-widget-popup-card-name {
          font-size: 13px;
          font-weight: 500;
          margin-bottom: 8px;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          line-height: 1.3;
        }

        .search-widget-popup-card-price {
          font-size: 14px;
        }

        .search-widget-popup-card-price .old-price {
          text-decoration: line-through;
          color: #999;
          margin-right: 6px;
          font-size: 12px;
        }

        .search-widget-popup-card-price .current-price {
          font-weight: bold;
          color: var(--search-primary-color);
        }

        /* Pagination */
        .search-widget-popup-pagination {
          padding: 16px 20px;
          border-top: 1px solid var(--search-border-color);
          flex-shrink: 0;
        }

        .search-widget-pagination-buttons {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 4px;
        }

        .search-widget-page-btn {
          min-width: 36px;
          height: 36px;
          padding: 0 12px;
          background: #fff;
          border: 1px solid #ddd;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          transition: all 0.2s;
        }

        .search-widget-page-btn:hover:not(:disabled) {
          background: #f5f5f5;
          border-color: #ccc;
        }

        .search-widget-page-btn.active {
          background: var(--search-primary-color);
          border-color: var(--search-primary-color);
          color: #fff;
        }

        .search-widget-page-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .search-widget-page-dots {
          padding: 0 8px;
          color: #999;
        }

        @media (max-width: 768px) {
          .search-widget-popup {
            max-height: 100vh;
            border-radius: 0;
          }

          .search-widget-popup-grid,
          .search-widget-category-grid {
            grid-template-columns: repeat(2, 1fr);
          }

          .search-widget-popup-body {
            flex-direction: column;
            overflow-y: auto;
          }

          .search-widget-facets-sidebar {
            width: 100%;
          }

          .search-widget-category-select {
            border-right: 1px solid var(--search-border-color);
            border-top-right-radius: var(--search-border-radius);
            border-bottom-right-radius: var(--search-border-radius);
          }
        }
      `;

      document.head.appendChild(styles);
    }
  }

  // ==================== Экспорт ====================
  
  window.SearchWidget = new SearchWidgetClass();

})(window, document);
