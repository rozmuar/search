/**
 * SearchPro Recommendations Widget - отдельный виджет рекомендаций товаров
 * Version: 1.0.0
 *
 * Использование:
 * <div id="search-recommendations"></div>
 * <script src="https://your-server.com/recommendations.js"></script>
 * <script>
 *   SearchRecommendations.init({
 *     apiKey: 'your_api_key',
 *     selector: '#search-recommendations',
 *     category: 'Ноутбуки', // опционально
 *   });
 * </script>
 */

(function(window, document) {
  'use strict';

  const currentScript = document.currentScript;
  const scriptSrc = currentScript?.src || '';
  const baseUrl = scriptSrc ? new URL(scriptSrc).origin : window.location.origin;

  const VERSION = '1.0.0';

  const DEFAULT_CONFIG = {
    apiUrl: baseUrl + '/api/v1',
    limit: 8,
    title: 'Рекомендуем',
    currency: 'RUB',
  };

  // ==================== Утилиты ====================

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : text;
    return div.innerHTML;
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

  // ==================== Главный класс виджета ====================

  class SearchRecommendationsClass {
    constructor() {
      this.config = null;
      this.container = null;
      this.initialized = false;
    }

    init(config) {
      if (this.initialized) {
        console.warn('[SearchRecommendations] already initialized');
        return this;
      }

      this.config = { ...DEFAULT_CONFIG, ...config };

      if (config.container && !config.selector) {
        this.config.selector = config.container;
      }

      if (!this.config.apiKey) {
        console.error('[SearchRecommendations] apiKey is required');
        return this;
      }

      this.container = typeof this.config.selector === 'string'
        ? document.querySelector(this.config.selector)
        : this.config.selector;

      if (!this.container) {
        console.error(`[SearchRecommendations] element not found: ${this.config.selector}`);
        return this;
      }

      this.loadServerConfig().then(() => {
        this.injectStyles();
        this.load();
      }).catch(err => {
        console.warn('[SearchRecommendations] Failed to load server config, using defaults:', err);
        this.injectStyles();
        this.load();
      });

      this.initialized = true;
      return this;
    }

    async loadServerConfig() {
      const response = await fetch(`${this.config.apiUrl}/widget/${this.config.apiKey}/config`);
      if (!response.ok) return;
      const serverConfig = await response.json();
      if (serverConfig.primaryColor) this.config.primaryColor = serverConfig.primaryColor;
      if (serverConfig.textColor) this.config.textColor = serverConfig.textColor;
      if (serverConfig.bgColor) this.config.bgColor = serverConfig.bgColor;
      if (serverConfig.borderColor) this.config.borderColor = serverConfig.borderColor;
      if (serverConfig.fontSize) this.config.fontSize = serverConfig.fontSize;
      if (serverConfig.borderRadius !== undefined) this.config.borderRadius = serverConfig.borderRadius;
      if (serverConfig.showImages !== undefined) this.config.showImages = serverConfig.showImages;
      if (serverConfig.showPrices !== undefined) this.config.showPrices = serverConfig.showPrices;
      if (serverConfig.showCartButton !== undefined) this.config.showCartButton = serverConfig.showCartButton;
      if (serverConfig.cartCallbackUrl) this.config.cartCallbackUrl = serverConfig.cartCallbackUrl;
    }

    async load() {
      try {
        const params = new URLSearchParams({ api_key: this.config.apiKey });
        if (this.config.category) params.append('category', this.config.category);
        if (this.config.limit) params.append('limit', this.config.limit);

        const response = await fetch(`${this.config.apiUrl}/recommendations?${params}`);
        if (!response.ok) throw new Error(`Recommendations failed: ${response.status}`);

        const data = await response.json();
        this.itemsById = {};
        (data.items || []).forEach(item => { this.itemsById[item.id] = item; });

        this.render(data.items || []);
      } catch (error) {
        console.error('[SearchRecommendations] load error:', error);
        this.container.style.display = 'none';
      }
    }

    render(items) {
      if (!items.length) {
        this.container.style.display = 'none';
        this.container.innerHTML = '';
        return;
      }

      this.container.style.display = '';
      const showImages = this.config.showImages !== false;
      const showPrices = this.config.showPrices !== false;
      const showCartButton = this.config.showCartButton !== false;

      let html = `<div class="search-recs-wrapper">`;
      if (this.config.title) {
        html += `<h3 class="search-recs-title">${escapeHtml(this.config.title)}</h3>`;
      }
      html += `
        <div class="search-recs-slider">
          <button type="button" class="search-recs-nav-btn search-recs-nav-prev" aria-label="Назад">‹</button>
          <div class="search-recs-track">
            ${items.map(item => this.renderCard(item, { showImages, showPrices, showCartButton })).join('')}
          </div>
          <button type="button" class="search-recs-nav-btn search-recs-nav-next" aria-label="Вперёд">›</button>
        </div>
      `;
      html += `</div>`;

      this.container.innerHTML = html;
      this.bindCardEvents();
      this.bindSliderNav();
    }

    // Прокрутка на "страницу" (видимая ширина трека) вместо одной карточки -
    // на широких экранах стрелка сразу открывает следующую группу товаров
    bindSliderNav() {
      const track = this.container.querySelector('.search-recs-track');
      const prevBtn = this.container.querySelector('.search-recs-nav-prev');
      const nextBtn = this.container.querySelector('.search-recs-nav-next');
      if (!track || !prevBtn || !nextBtn) return;

      const scrollByPage = (direction) => {
        track.scrollBy({ left: direction * track.clientWidth * 0.9, behavior: 'smooth' });
      };
      prevBtn.addEventListener('click', () => scrollByPage(-1));
      nextBtn.addEventListener('click', () => scrollByPage(1));

      const updateNavVisibility = () => {
        const hasOverflow = track.scrollWidth > track.clientWidth + 1;
        prevBtn.style.display = hasOverflow ? '' : 'none';
        nextBtn.style.display = hasOverflow ? '' : 'none';
        prevBtn.disabled = track.scrollLeft <= 0;
        nextBtn.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
      };

      track.addEventListener('scroll', updateNavVisibility, { passive: true });
      window.addEventListener('resize', updateNavVisibility);
      updateNavVisibility();
    }

    renderCard(product, { showImages, showPrices, showCartButton }) {
      const price = product.price ? formatPrice(product.price, this.config.currency) : '';
      const oldPrice = product.old_price ? formatPrice(product.old_price, this.config.currency) : '';
      const inStock = product.in_stock !== false;

      return `
        <div class="search-recs-card ${!inStock ? 'out-of-stock' : ''}" data-id="${escapeHtml(String(product.id))}">
          <a href="${product.url || '#'}">
            ${showImages ? `<div class="search-recs-card-image">
              <img src="${product.image || ''}" alt="${escapeHtml(product.name || '')}" loading="lazy" onerror="this.style.display='none'">
            </div>` : ''}
            <div class="search-recs-card-info">
              <div class="search-recs-card-name">${escapeHtml(product.name || '')}</div>
              ${showPrices && price ? `<div class="search-recs-card-price">
                ${oldPrice ? `<span class="old-price">${oldPrice}</span>` : ''}
                <span class="current-price">${price}</span>
              </div>` : ''}
              ${!inStock ? '<div class="search-recs-out-of-stock">Нет в наличии</div>' : ''}
            </div>
          </a>
          ${inStock && showCartButton ? `
            <div class="search-recs-cart-row">
              <div class="search-recs-qty-stepper">
                <button type="button" class="qty-minus">−</button>
                <input type="number" class="qty-input" min="1" value="1">
                <button type="button" class="qty-plus">+</button>
              </div>
              <button type="button" class="search-recs-add-to-cart-btn">В корзину</button>
            </div>
          ` : ''}
        </div>
      `;
    }

    bindCardEvents() {
      this.container.querySelectorAll('.search-recs-card').forEach(card => {
        const productId = card.dataset.id;

        const link = card.querySelector('a');
        link?.addEventListener('click', (e) => {
          e.preventDefault();
          this.trackClick(productId);
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

        const cartBtn = card.querySelector('.search-recs-add-to-cart-btn');
        cartBtn?.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const quantity = Math.max(1, parseInt(qtyInput?.value, 10) || 1);
          const product = this.itemsById[productId] || { id: productId };
          this.addToCart(product, quantity, cartBtn);
        });
      });
    }

    // Синтетическая query "[recommendation]" вместо пустой строки - чтобы клики по
    // рекомендациям были опознаваемы в аналитике, но всё равно кормили popular_products
    // (от которого зависит этап "popular" волны на бэкенде - самоусиливающийся цикл)
    trackClick(productId) {
      try {
        fetch(`${this.config.apiUrl}/track/click`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: this.config.apiKey,
            product_id: productId,
            query: '[recommendation]',
          }),
          keepalive: true,
          mode: 'cors',
          credentials: 'omit',
        }).catch(err => console.error('[SearchRecommendations] click tracking error:', err));
      } catch (e) {
        console.error('[SearchRecommendations] trackClick error:', e);
      }
    }

    async addToCart(product, quantity, buttonEl) {
      if (!this.config.cartCallbackUrl) {
        console.warn('[SearchRecommendations] cartCallbackUrl is not configured - "В корзину" is a no-op.');
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
        const response = await fetch(this.config.cartCallbackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true,
          mode: 'cors',
          credentials: 'omit',
        });
        if (!response.ok) throw new Error(`Cart callback failed: ${response.status}`);
        buttonEl.textContent = 'Добавлено ✓';
        buttonEl.classList.add('search-recs-cart-success');
        setTimeout(() => {
          buttonEl.textContent = originalText;
          buttonEl.classList.remove('search-recs-cart-success');
          buttonEl.disabled = false;
        }, 1500);
      } catch (error) {
        console.error('[SearchRecommendations] addToCart error:', error);
        buttonEl.textContent = 'Не удалось добавить';
        buttonEl.classList.add('search-recs-cart-error');
        setTimeout(() => {
          buttonEl.textContent = originalText;
          buttonEl.classList.remove('search-recs-cart-error');
          buttonEl.disabled = false;
        }, 1500);
      }
    }

    injectStyles() {
      if (document.getElementById('search-recs-styles')) return;

      const primaryColor = this.config.primaryColor || '#007bff';
      const borderRadius = this.config.borderRadius !== undefined ? this.config.borderRadius + 'px' : '8px';
      const textColor = this.config.textColor || '#111827';
      const bgColor = this.config.bgColor || '#ffffff';
      const borderColor = this.config.borderColor || '#e5e7eb';
      const fontSize = this.config.fontSize ? this.config.fontSize + 'px' : '14px';

      const styles = document.createElement('style');
      styles.id = 'search-recs-styles';
      styles.textContent = `
        :root {
          --search-recs-primary-color: ${primaryColor};
          --search-recs-text-color: ${textColor};
          --search-recs-text-secondary: color-mix(in srgb, ${textColor} 62%, ${bgColor});
          --search-recs-text-tertiary: color-mix(in srgb, ${textColor} 42%, ${bgColor});
          --search-recs-background: ${bgColor};
          --search-recs-surface: color-mix(in srgb, ${textColor} 4%, ${bgColor});
          --search-recs-border-color: ${borderColor};
          --search-recs-success-color: #059669;
          --search-recs-danger-color: #dc2626;
          --search-recs-border-radius: ${borderRadius};
          --search-recs-radius-sm: calc(var(--search-recs-border-radius) * 0.65);
          --search-recs-font-size: ${fontSize};
          --search-recs-shadow-xs: 0 1px 2px rgba(16, 24, 40, 0.06);
          --search-recs-shadow-md: 0 8px 24px -4px rgba(16, 24, 40, 0.12), 0 2px 6px -2px rgba(16, 24, 40, 0.06);
        }

        .search-recs-wrapper * {
          box-sizing: border-box;
        }

        .search-recs-wrapper {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          font-size: var(--search-recs-font-size);
          -webkit-font-smoothing: antialiased;
          color: var(--search-recs-text-color);
        }

        .search-recs-title {
          margin: 0 0 16px;
          font-size: 1.35em;
          font-weight: 600;
          letter-spacing: -0.01em;
          color: var(--search-recs-text-color);
        }

        .search-recs-slider {
          position: relative;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .search-recs-track {
          flex: 1;
          display: flex;
          gap: 16px;
          overflow-x: auto;
          scroll-snap-type: x mandatory;
          scroll-behavior: smooth;
          padding-bottom: 4px;
          /* Скроллбар скрыт - навигация через стрелки/свайп, не системный скроллбар */
          scrollbar-width: none;
          -ms-overflow-style: none;
        }

        .search-recs-track::-webkit-scrollbar {
          display: none;
        }

        .search-recs-nav-btn {
          flex-shrink: 0;
          width: 36px;
          height: 36px;
          border-radius: 50%;
          border: 1px solid var(--search-recs-border-color);
          background: var(--search-recs-background);
          color: var(--search-recs-text-color);
          font-size: 20px;
          line-height: 1;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: box-shadow 0.15s ease, background-color 0.15s ease, opacity 0.15s ease;
          box-shadow: var(--search-recs-shadow-xs);
        }

        .search-recs-nav-btn:hover:not(:disabled) {
          box-shadow: var(--search-recs-shadow-md);
        }

        .search-recs-nav-btn:disabled {
          opacity: 0.3;
          cursor: default;
        }

        .search-recs-card {
          display: flex;
          flex-direction: column;
          flex: 0 0 180px;
          width: 180px;
          scroll-snap-align: start;
          border: 1px solid var(--search-recs-border-color);
          border-radius: var(--search-recs-radius-sm);
          overflow: hidden;
          background: var(--search-recs-background);
          transition: box-shadow 0.2s ease, transform 0.2s ease, border-color 0.2s ease;
        }

        .search-recs-card:hover {
          box-shadow: var(--search-recs-shadow-md);
          border-color: transparent;
          transform: translateY(-3px);
        }

        .search-recs-card.out-of-stock {
          opacity: 0.55;
        }

        .search-recs-card a {
          text-decoration: none;
          color: var(--search-recs-text-color);
        }

        .search-recs-card-image {
          height: 140px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--search-recs-surface);
          padding: 10px;
        }

        .search-recs-card-image img {
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
        }

        .search-recs-card-info {
          padding: 12px 13px;
        }

        .search-recs-card-name {
          font-size: 0.93em;
          font-weight: 500;
          margin-bottom: 7px;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          line-height: 1.35;
        }

        .search-recs-card-price {
          font-size: 1em;
        }

        .search-recs-card-price .old-price {
          text-decoration: line-through;
          color: var(--search-recs-text-tertiary);
          margin-right: 6px;
          font-size: 0.85em;
        }

        .search-recs-card-price .current-price {
          font-weight: 700;
          color: var(--search-recs-primary-color);
        }

        .search-recs-out-of-stock {
          display: inline-block;
          margin-top: 6px;
          font-size: 0.8em;
          font-weight: 500;
          color: var(--search-recs-danger-color);
        }

        .search-recs-cart-row {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 13px 13px;
        }

        .search-recs-qty-stepper {
          display: flex;
          align-items: center;
          border: 1.5px solid var(--search-recs-border-color);
          border-radius: var(--search-recs-radius-sm);
          flex-shrink: 0;
        }

        .search-recs-qty-stepper button {
          width: 26px;
          height: 28px;
          background: none;
          border: none;
          color: var(--search-recs-text-secondary);
          cursor: pointer;
          font-size: 14px;
          line-height: 1;
          transition: color 0.15s ease;
        }

        .search-recs-qty-stepper button:hover {
          color: var(--search-recs-text-color);
        }

        .search-recs-qty-stepper .qty-input {
          width: 30px;
          border: none;
          background: transparent;
          color: var(--search-recs-text-color);
          text-align: center;
          font-size: 13px;
          font-family: inherit;
          -moz-appearance: textfield;
        }

        .search-recs-qty-stepper .qty-input::-webkit-outer-spin-button,
        .search-recs-qty-stepper .qty-input::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }

        .search-recs-add-to-cart-btn {
          flex: 1;
          padding: 7px 8px;
          background: var(--search-recs-primary-color);
          color: #fff;
          border: none;
          border-radius: 10px;
          cursor: pointer;
          font-size: 10px;
          font-weight: 600;
          transition: filter 0.15s ease, box-shadow 0.15s ease, transform 0.1s ease;
        }

        .search-recs-add-to-cart-btn:hover:not(:disabled) {
          filter: brightness(1.08);
          box-shadow: var(--search-recs-shadow-xs);
        }

        .search-recs-add-to-cart-btn:active:not(:disabled) {
          transform: scale(0.97);
        }

        .search-recs-add-to-cart-btn:disabled {
          cursor: default;
        }

        .search-recs-add-to-cart-btn.search-recs-cart-success {
          background: var(--search-recs-success-color);
        }

        .search-recs-add-to-cart-btn.search-recs-cart-error {
          background: var(--search-recs-danger-color);
        }
      `;
      document.head.appendChild(styles);
    }
  }

  window.SearchRecommendations = new SearchRecommendationsClass();
  window.SearchRecommendations.VERSION = VERSION;

})(window, document);
