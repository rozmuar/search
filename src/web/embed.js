/**
 * SearchPro Widget Embed Script
 * Встраиваемый виджет поиска для интернет-магазинов
 */
(function() {
    'use strict';

    // Get config from data attribute or global config
    const script = document.currentScript;
    const apiKey = script?.getAttribute('data-api-key') || window.SearchProConfig?.apiKey;
    
    if (!apiKey) {
        console.error('SearchPro: API key not provided');
        return;
    }

    // Default config
    const config = Object.assign({
        apiKey: apiKey,
        container: '#searchpro-widget',
        placeholder: 'Поиск товаров...',
        theme: 'light',
        primaryColor: '#2563eb',
        textColor: '#1f2937',
        bgColor: '#ffffff',
        borderRadius: 8,
        showImages: true,
        showPrices: true,
        showSuggestions: true,
        resultsPerPage: 10,
        minQueryLength: 2,
        debounceMs: 300,
        onSearch: null,
        onSelect: null,
        onError: null
    }, window.SearchProConfig || {});

    // API Base URL (relative for same-origin, or absolute)
    const API_BASE = window.SearchProConfig?.apiBase || '/api/v1';

    // State
    let widgetConfig = null;
    let searchTimeout = null;
    let currentQuery = '';
    let isLoading = false;

    // Styles
    const styles = `
        .sp-widget {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            position: relative;
            width: 100%;
            max-width: 600px;
        }

        .sp-widget * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        .sp-search-box {
            position: relative;
            display: flex;
            gap: 8px;
        }

        .sp-search-input {
            flex: 1;
            padding: 12px 16px;
            padding-right: 44px;
            border: 2px solid #e5e7eb;
            border-radius: var(--sp-border-radius, 8px);
            font-size: 16px;
            background: var(--sp-bg-color, #ffffff);
            color: var(--sp-text-color, #1f2937);
            outline: none;
            transition: border-color 0.2s, box-shadow 0.2s;
        }

        .sp-search-input:focus {
            border-color: var(--sp-primary-color, #2563eb);
            box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
        }

        .sp-search-input::placeholder {
            color: #9ca3af;
        }

        .sp-search-btn {
            position: absolute;
            right: 8px;
            top: 50%;
            transform: translateY(-50%);
            background: var(--sp-primary-color, #2563eb);
            color: #fff;
            border: none;
            width: 32px;
            height: 32px;
            border-radius: calc(var(--sp-border-radius, 8px) - 4px);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.2s;
        }

        .sp-search-btn:hover {
            filter: brightness(0.9);
        }

        .sp-search-btn svg {
            width: 16px;
            height: 16px;
        }

        .sp-suggestions {
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            background: var(--sp-bg-color, #ffffff);
            border: 1px solid #e5e7eb;
            border-radius: var(--sp-border-radius, 8px);
            margin-top: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
            z-index: 1000;
            max-height: 200px;
            overflow-y: auto;
            display: none;
        }

        .sp-suggestions.show {
            display: block;
        }

        .sp-suggestion-item {
            padding: 10px 16px;
            cursor: pointer;
            font-size: 14px;
            color: var(--sp-text-color, #1f2937);
            transition: background 0.15s;
        }

        .sp-suggestion-item:hover,
        .sp-suggestion-item.active {
            background: #f3f4f6;
        }

        .sp-suggestion-item mark {
            background: rgba(37, 99, 235, 0.2);
            color: inherit;
            padding: 0 2px;
            border-radius: 2px;
        }

        .sp-results {
            margin-top: 16px;
        }

        .sp-results-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
            font-size: 14px;
            color: #6b7280;
        }

        .sp-results-count {
            font-weight: 500;
        }

        .sp-results-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .sp-result-item {
            display: flex;
            gap: 16px;
            padding: 16px;
            background: var(--sp-bg-color, #ffffff);
            border: 1px solid #e5e7eb;
            border-radius: var(--sp-border-radius, 8px);
            cursor: pointer;
            transition: border-color 0.2s, box-shadow 0.2s;
            text-decoration: none;
            color: inherit;
        }

        .sp-result-item:hover {
            border-color: var(--sp-primary-color, #2563eb);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        }

        .sp-result-image {
            width: 80px;
            height: 80px;
            object-fit: contain;
            background: #f9fafb;
            border-radius: calc(var(--sp-border-radius, 8px) - 4px);
            flex-shrink: 0;
        }

        .sp-result-image.hidden {
            display: none;
        }

        .sp-result-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            min-width: 0;
        }

        .sp-result-title {
            font-size: 15px;
            font-weight: 500;
            color: var(--sp-text-color, #1f2937);
            margin-bottom: 4px;
            overflow: hidden;
            text-overflow: ellipsis;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
        }

        .sp-result-title mark {
            background: rgba(37, 99, 235, 0.2);
            color: inherit;
            padding: 0 2px;
            border-radius: 2px;
        }

        .sp-result-category {
            font-size: 13px;
            color: #9ca3af;
            margin-bottom: 8px;
        }

        .sp-result-price {
            font-size: 18px;
            font-weight: 700;
            color: var(--sp-primary-color, #2563eb);
            margin-top: auto;
        }

        .sp-result-price.hidden {
            display: none;
        }

        .sp-result-old-price {
            font-size: 14px;
            color: #9ca3af;
            text-decoration: line-through;
            margin-left: 8px;
            font-weight: 400;
        }

        .sp-result-availability {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 500;
            margin-top: 8px;
        }

        .sp-result-availability.in-stock {
            background: #d1fae5;
            color: #065f46;
        }

        .sp-result-availability.out-of-stock {
            background: #fee2e2;
            color: #991b1b;
        }

        .sp-loading {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 32px;
        }

        .sp-spinner {
            width: 32px;
            height: 32px;
            border: 3px solid #e5e7eb;
            border-top-color: var(--sp-primary-color, #2563eb);
            border-radius: 50%;
            animation: sp-spin 0.8s linear infinite;
        }

        @keyframes sp-spin {
            to { transform: rotate(360deg); }
        }

        .sp-no-results {
            text-align: center;
            padding: 32px;
            color: #6b7280;
        }

        .sp-no-results-icon {
            font-size: 48px;
            margin-bottom: 8px;
        }

        .sp-no-results-text {
            font-size: 15px;
        }

        .sp-pagination {
            display: flex;
            justify-content: center;
            gap: 8px;
            margin-top: 20px;
        }

        .sp-page-btn {
            padding: 8px 14px;
            border: 1px solid #e5e7eb;
            background: var(--sp-bg-color, #ffffff);
            color: var(--sp-text-color, #1f2937);
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s;
        }

        .sp-page-btn:hover:not(:disabled) {
            border-color: var(--sp-primary-color, #2563eb);
        }

        .sp-page-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .sp-page-btn.active {
            background: var(--sp-primary-color, #2563eb);
            color: #fff;
            border-color: var(--sp-primary-color, #2563eb);
        }

        /* Dark theme */
        .sp-widget.sp-dark {
            --sp-bg-color: #1f2937;
            --sp-text-color: #f3f4f6;
        }

        .sp-widget.sp-dark .sp-search-input {
            border-color: #374151;
            background: #111827;
        }

        .sp-widget.sp-dark .sp-suggestions,
        .sp-widget.sp-dark .sp-result-item {
            background: #1f2937;
            border-color: #374151;
        }

        .sp-widget.sp-dark .sp-suggestion-item:hover,
        .sp-widget.sp-dark .sp-suggestion-item.active {
            background: #374151;
        }

        .sp-widget.sp-dark .sp-result-image {
            background: #374151;
        }

        /* Responsive */
        @media (max-width: 480px) {
            .sp-result-item {
                flex-direction: column;
            }

            .sp-result-image {
                width: 100%;
                height: 160px;
            }

            .sp-result-price {
                font-size: 16px;
            }
        }
    `;

    // Inject styles
    function injectStyles() {
        const styleEl = document.createElement('style');
        styleEl.id = 'searchpro-styles';
        styleEl.textContent = styles;
        document.head.appendChild(styleEl);
    }

    // Load widget config from server
    async function loadWidgetConfig() {
        try {
            const response = await fetch(`${API_BASE}/widget/${config.apiKey}/config`);
            if (response.ok) {
                widgetConfig = await response.json();
                applyConfig(widgetConfig);
            }
        } catch (error) {
            console.error('SearchPro: Failed to load widget config', error);
        }
    }

    // Apply server config
    function applyConfig(serverConfig) {
        if (serverConfig.theme) config.theme = serverConfig.theme;
        if (serverConfig.primary_color) config.primaryColor = serverConfig.primary_color;
        if (serverConfig.text_color) config.textColor = serverConfig.text_color;
        if (serverConfig.bg_color) config.bgColor = serverConfig.bg_color;
        if (serverConfig.border_radius) config.borderRadius = serverConfig.border_radius;
        if (serverConfig.placeholder) config.placeholder = serverConfig.placeholder;
        if (serverConfig.results_per_page) config.resultsPerPage = serverConfig.results_per_page;
        if (typeof serverConfig.show_images === 'boolean') config.showImages = serverConfig.show_images;
        if (typeof serverConfig.show_prices === 'boolean') config.showPrices = serverConfig.show_prices;
        if (typeof serverConfig.show_suggestions === 'boolean') config.showSuggestions = serverConfig.show_suggestions;
        
        updateWidgetStyles();
    }

    // Update CSS variables
    function updateWidgetStyles() {
        const widget = document.querySelector('.sp-widget');
        if (!widget) return;

        widget.style.setProperty('--sp-primary-color', config.primaryColor);
        widget.style.setProperty('--sp-text-color', config.textColor);
        widget.style.setProperty('--sp-bg-color', config.bgColor);
        widget.style.setProperty('--sp-border-radius', config.borderRadius + 'px');

        if (config.theme === 'dark') {
            widget.classList.add('sp-dark');
        } else if (config.theme === 'auto') {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            widget.classList.toggle('sp-dark', prefersDark);
        } else {
            widget.classList.remove('sp-dark');
        }
    }

    // Create widget HTML
    function createWidget() {
        const container = document.querySelector(config.container);
        if (!container) {
            console.error('SearchPro: Container not found:', config.container);
            return;
        }

        const themeClass = config.theme === 'dark' ? 'sp-dark' : '';

        container.innerHTML = `
            <div class="sp-widget ${themeClass}">
                <div class="sp-search-box">
                    <input type="text" 
                           class="sp-search-input" 
                           placeholder="${escapeHtml(config.placeholder)}"
                           autocomplete="off">
                    <button type="button" class="sp-search-btn" aria-label="Поиск">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                    </button>
                    <div class="sp-suggestions"></div>
                </div>
                <div class="sp-results"></div>
            </div>
        `;

        updateWidgetStyles();
        attachEventListeners();
    }

    // Attach event listeners
    function attachEventListeners() {
        const input = document.querySelector('.sp-search-input');
        const searchBtn = document.querySelector('.sp-search-btn');
        const suggestions = document.querySelector('.sp-suggestions');

        if (input) {
            input.addEventListener('input', handleInput);
            input.addEventListener('keydown', handleKeydown);
            input.addEventListener('focus', () => {
                if (currentQuery.length >= config.minQueryLength && config.showSuggestions) {
                    suggestions?.classList.add('show');
                }
            });
        }

        if (searchBtn) {
            searchBtn.addEventListener('click', () => {
                const query = input?.value.trim();
                if (query) {
                    performSearch(query);
                }
            });
        }

        // Close suggestions on outside click
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.sp-widget')) {
                suggestions?.classList.remove('show');
            }
        });
    }

    // Handle input
    function handleInput(e) {
        const query = e.target.value.trim();
        currentQuery = query;

        if (searchTimeout) {
            clearTimeout(searchTimeout);
        }

        if (query.length < config.minQueryLength) {
            document.querySelector('.sp-suggestions')?.classList.remove('show');
            return;
        }

        searchTimeout = setTimeout(() => {
            if (config.showSuggestions) {
                loadSuggestions(query);
            }
        }, config.debounceMs);
    }

    // Handle keyboard navigation
    function handleKeydown(e) {
        const suggestions = document.querySelector('.sp-suggestions');
        const items = suggestions?.querySelectorAll('.sp-suggestion-item');
        const activeItem = suggestions?.querySelector('.sp-suggestion-item.active');

        if (e.key === 'Enter') {
            e.preventDefault();
            if (activeItem) {
                activeItem.click();
            } else {
                performSearch(e.target.value.trim());
            }
            return;
        }

        if (!items?.length) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const next = activeItem?.nextElementSibling || items[0];
            items.forEach(i => i.classList.remove('active'));
            next.classList.add('active');
            document.querySelector('.sp-search-input').value = next.textContent;
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const prev = activeItem?.previousElementSibling || items[items.length - 1];
            items.forEach(i => i.classList.remove('active'));
            prev.classList.add('active');
            document.querySelector('.sp-search-input').value = prev.textContent;
        } else if (e.key === 'Escape') {
            suggestions?.classList.remove('show');
        }
    }

    // Load suggestions
    async function loadSuggestions(query) {
        try {
            const response = await fetch(`${API_BASE}/suggest?api_key=${encodeURIComponent(config.apiKey)}&q=${encodeURIComponent(query)}&limit=5`);
            if (!response.ok) return;

            const data = await response.json();
            renderSuggestions(data.suggestions || [], query);
        } catch (error) {
            console.error('SearchPro: Suggestions error', error);
        }
    }

    // Render suggestions
    function renderSuggestions(suggestions, query) {
        const container = document.querySelector('.sp-suggestions');
        if (!container) return;

        if (suggestions.length === 0) {
            container.classList.remove('show');
            return;
        }

        container.innerHTML = suggestions.map(suggestion => {
            const highlighted = highlightMatch(suggestion, query);
            return `<div class="sp-suggestion-item">${highlighted}</div>`;
        }).join('');

        container.classList.add('show');

        // Add click handlers
        container.querySelectorAll('.sp-suggestion-item').forEach(item => {
            item.addEventListener('click', () => {
                const text = item.textContent;
                document.querySelector('.sp-search-input').value = text;
                container.classList.remove('show');
                performSearch(text);
            });
        });
    }

    // Perform search
    async function performSearch(query, page = 1) {
        if (!query || query.length < config.minQueryLength) return;

        const resultsContainer = document.querySelector('.sp-results');
        if (!resultsContainer) return;

        document.querySelector('.sp-suggestions')?.classList.remove('show');

        // Show loading
        isLoading = true;
        resultsContainer.innerHTML = `
            <div class="sp-loading">
                <div class="sp-spinner"></div>
            </div>
        `;

        try {
            const response = await fetch(
                `${API_BASE}/search?api_key=${encodeURIComponent(config.apiKey)}&q=${encodeURIComponent(query)}&page=${page}&limit=${config.resultsPerPage}`
            );

            if (!response.ok) {
                throw new Error('Search failed');
            }

            const data = await response.json();
            
            if (config.onSearch) {
                config.onSearch(query, data);
            }

            renderResults(data, query, page);

        } catch (error) {
            console.error('SearchPro: Search error', error);
            
            if (config.onError) {
                config.onError(error);
            }

            resultsContainer.innerHTML = `
                <div class="sp-no-results">
                    <div class="sp-no-results-icon">❌</div>
                    <div class="sp-no-results-text">Ошибка поиска. Попробуйте позже.</div>
                </div>
            `;
        } finally {
            isLoading = false;
        }
    }

    // Render search results
    function renderResults(data, query, currentPage) {
        const resultsContainer = document.querySelector('.sp-results');
        if (!resultsContainer) return;

        const products = data.products || [];
        const total = data.total || 0;
        const totalPages = Math.ceil(total / config.resultsPerPage);

        if (products.length === 0) {
            resultsContainer.innerHTML = `
                <div class="sp-no-results">
                    <div class="sp-no-results-icon">🔍</div>
                    <div class="sp-no-results-text">По запросу «${escapeHtml(query)}» ничего не найдено</div>
                </div>
            `;
            return;
        }

        let html = `
            <div class="sp-results-header">
                <span class="sp-results-count">Найдено: ${total}</span>
            </div>
            <div class="sp-results-list">
        `;

        products.forEach(product => {
            const imageClass = config.showImages ? '' : 'hidden';
            const priceClass = config.showPrices ? '' : 'hidden';
            const title = highlightMatch(product.name || '', query);
            const url = product.url || '#';
            
            html += `
                <a href="${escapeHtml(url)}" class="sp-result-item" data-product-id="${product.id}">
                    <img src="${escapeHtml(product.image || '')}" 
                         alt="${escapeHtml(product.name || '')}" 
                         class="sp-result-image ${imageClass}"
                         onerror="this.style.background='#f3f4f6'; this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAiIGhlaWdodD0iODAiIHZpZXdCb3g9IjAgMCA4MCA4MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iODAiIGhlaWdodD0iODAiIGZpbGw9IiNGM0Y0RjYiLz48L3N2Zz4='">
                    <div class="sp-result-content">
                        <div class="sp-result-title">${title}</div>
                        ${product.category ? `<div class="sp-result-category">${escapeHtml(product.category)}</div>` : ''}
                        <div class="sp-result-price ${priceClass}">
                            ${formatPrice(product.price)} ₽
                            ${product.oldprice ? `<span class="sp-result-old-price">${formatPrice(product.oldprice)} ₽</span>` : ''}
                        </div>
                    </div>
                </a>
            `;
        });

        html += '</div>';

        // Pagination
        if (totalPages > 1) {
            html += '<div class="sp-pagination">';
            html += `<button class="sp-page-btn" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}>&lt;</button>`;
            
            for (let i = 1; i <= Math.min(totalPages, 5); i++) {
                html += `<button class="sp-page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
            }
            
            if (totalPages > 5) {
                html += `<button class="sp-page-btn" disabled>...</button>`;
                html += `<button class="sp-page-btn ${totalPages === currentPage ? 'active' : ''}" data-page="${totalPages}">${totalPages}</button>`;
            }
            
            html += `<button class="sp-page-btn" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}>&gt;</button>`;
            html += '</div>';
        }

        resultsContainer.innerHTML = html;

        // Add pagination handlers
        resultsContainer.querySelectorAll('.sp-page-btn:not(:disabled)').forEach(btn => {
            btn.addEventListener('click', () => {
                const page = parseInt(btn.dataset.page);
                performSearch(query, page);
            });
        });

        // Add product click handlers
        resultsContainer.querySelectorAll('.sp-result-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const productId = item.dataset.productId;
                const product = products.find(p => p.id == productId);
                
                if (config.onSelect && product) {
                    e.preventDefault();
                    config.onSelect(product);
                }

                // Track click
                trackClick(productId, query);
            });
        });
    }

    // Track click for analytics
    async function trackClick(productId, query) {
        try {
            await fetch(`${API_BASE}/track/click`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    api_key: config.apiKey,
                    product_id: productId,
                    query: query
                })
            });
        } catch (error) {
            // Silent fail
        }
    }

    // Highlight search match
    function highlightMatch(text, query) {
        if (!query) return escapeHtml(text);
        
        const escaped = escapeHtml(text);
        const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
        return escaped.replace(regex, '<mark>$1</mark>');
    }

    // Escape HTML
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }

    // Escape regex special chars
    function escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // Format price
    function formatPrice(price) {
        return new Intl.NumberFormat('ru-RU').format(price || 0);
    }

    // Initialize
    function init() {
        injectStyles();
        createWidget();
        loadWidgetConfig();
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose API for manual control
    window.SearchPro = {
        search: performSearch,
        config: config,
        refresh: loadWidgetConfig
    };

})();
