/**
 * SearchPro Widget - JavaScript виджет для внешнего поиска
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
      productLimit: 4,
    },
    
    results: {
      enabled: true,
      limit: 20,
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
      if (options.filters) {
        Object.entries(options.filters).forEach(([k, v]) => params.append(k, v));
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
        const body = JSON.stringify({
          type: eventType,
          ...data,
          timestamp: Date.now(),
        });
        
        if (navigator.sendBeacon) {
          navigator.sendBeacon(`${this.apiUrl}/analytics/event`, body);
        } else {
          fetch(`${this.apiUrl}/analytics/event`, {
            method: 'POST',
            headers: {
              'X-API-Key': this.apiKey,
              'Content-Type': 'application/json',
            },
            body: body,
            keepalive: true,
          });
        }
      } catch (e) {
        // Ignore analytics errors
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
        html += '<div class="search-widget-suggestions-section search-widget-products">';
        html += '<div class="search-widget-section-title">Товары</div>';
        html += suggestions.products.map((product, index) => {
          const image = product.image || product.picture;
          const price = product.price;
          const oldPrice = product.old_price || product.oldPrice;
          return `
            <a href="${product.url || '#'}" class="search-widget-suggestion-item search-widget-product" data-type="product" data-id="${product.id}" data-index="${index}">
              ${image ? `<img src="${image}" alt="" class="search-widget-product-image" loading="lazy">` : ''}
              <div class="search-widget-product-info">
                <div class="search-widget-product-name">${escapeHtml(product.name)}</div>
                <div class="search-widget-product-price">
                  ${oldPrice ? `<span class="search-widget-old-price">${formatPrice(oldPrice, this.widget.config.currency)}</span>` : ''}
                  <span class="search-widget-current-price">${formatPrice(price, this.widget.config.currency)}</span>
                </div>
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
      
      items.forEach((item, index) => {
        item.addEventListener('click', (e) => {
          const type = item.dataset.type;
          
          if (type === 'query') {
            e.preventDefault();
            this.widget.selectSuggestion(item.dataset.value);
          } else if (type === 'product') {
            this.widget.trackClick(item.dataset.id, index);
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
    }

    bindEvents() {
      const handleInput = debounce((e) => {
        const query = e.target.value.trim();
        this.state.query = query;

        if (query.length >= this.config.minChars) {
          this.fetchSuggestions(query);
        } else {
          this.suggestions.hide();
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

      this.input.addEventListener('focus', () => {
        if (this.state.query.length >= this.config.minChars) {
          this.fetchSuggestions(this.state.query);
        }
      });
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
      this.input.value = value;
      this.state.query = value;
      this.suggestions.hide();
      this.performSearch();
    }

    async performSearch() {
      const query = this.input.value.trim();
      
      if (!query) return;

      this.suggestions.hide();
      this.state.loading = true;

      if (this.config.onSearch) {
        this.config.onSearch(query);
        this.state.loading = false;
        return;
      }

      await this.search(query);
    }

    async search(query, options = {}) {
      try {
        this.state.loading = true;
        this.state.query = query;
        this.input.value = query;

        const data = await this.api.search(query, {
          limit: this.config.results.limit,
          ...options,
          filters: { ...this.state.filters, ...options.filters },
        });

        this.state.results = data.items || data.products || [];
        this.state.loading = false;

        this.emit('search', { query, results: data });

        if (this.config.analytics.enabled) {
          this.api.trackEvent('search', {
            query,
            results_count: data.total || this.state.results.length,
          });
        }

        if (this.config.results.enabled && this.config.resultsSelector) {
          this.renderResults(data);
        }

        return data;

      } catch (error) {
        this.state.loading = false;
        console.error('SearchWidget search error:', error);
        this.emit('error', { error, context: 'search' });
        throw error;
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
        card.addEventListener('click', () => {
          this.trackClick(card.dataset.id, index);
        });
      });
    }

    renderProductCard(product, index) {
      const template = this.config.templates?.productCard;
      if (template) {
        return template(product);
      }

      const image = product.image || product.picture;
      const oldPrice = product.old_price || product.oldPrice;
      const inStock = product.in_stock !== false && product.available !== false;

      return `
        <div class="search-widget-result-card" data-id="${product.id}">
          <a href="${product.url || '#'}">
            ${image ? `<img src="${image}" alt="${escapeHtml(product.name)}" loading="lazy">` : ''}
            <div class="search-widget-result-info">
              <h3>${product.attributes?._highlighted_name || escapeHtml(product.name)}</h3>
              <div class="search-widget-result-price">
                ${oldPrice ? `<span class="old">${formatPrice(oldPrice, this.config.currency)}</span>` : ''}
                <span class="current">${formatPrice(product.price, this.config.currency)}</span>
              </div>
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

      const styles = document.createElement('style');
      styles.id = 'search-widget-styles';
      styles.textContent = `
        :root {
          --search-primary-color: #007bff;
          --search-text-color: #333;
          --search-background: #fff;
          --search-border-color: #ddd;
          --search-highlight-color: #fff3cd;
          --search-border-radius: 8px;
          --search-font-size: 14px;
          --search-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }

        .search-widget-wrapper {
          position: relative;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: var(--search-font-size);
        }

        .search-widget-input {
          width: 100%;
          padding: 12px 16px;
          border: 1px solid var(--search-border-color);
          border-radius: var(--search-border-radius);
          font-size: var(--search-font-size);
          outline: none;
          transition: border-color 0.2s;
          box-sizing: border-box;
        }

        .search-widget-input:focus {
          border-color: var(--search-primary-color);
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
      `;

      document.head.appendChild(styles);
    }
  }

  // ==================== Экспорт ====================
  
  window.SearchWidget = new SearchWidgetClass();

})(window, document);
