// Dashboard Application
let currentUser = null;
let projects = [];
let currentProject = null;
let products = [];
let currentPage = 1;
const productsPerPage = 20;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    initNavigation();
    initPeriodButtons();
});

// Auth Check
async function checkAuth() {
    const token = localStorage.getItem('authToken');
    if (!token) {
        window.location.href = 'auth.html';
        return;
    }

    try {
        currentUser = await API.getMe();
        document.getElementById('userEmail').textContent = currentUser.email;
        await loadProjects();
    } catch (error) {
        console.error('Auth error:', error);
        localStorage.removeItem('authToken');
        window.location.href = 'auth.html';
    }
}

function logout() {
    localStorage.removeItem('authToken');
    window.location.href = 'auth.html';
}

// Navigation
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const section = item.dataset.section;
            showSection(section);
            
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
        });
    });
}

function showSection(sectionName) {
    const sections = document.querySelectorAll('.content-section');
    sections.forEach(section => section.classList.remove('active'));
    
    const targetSection = document.getElementById(`section-${sectionName}`);
    if (targetSection) {
        targetSection.classList.add('active');
    }
}

// Projects
async function loadProjects() {
    try {
        projects = await API.getProjects();
        renderProjects();
        populateProjectSelectors();
    } catch (error) {
        console.error('Error loading projects:', error);
        showToast('Ошибка загрузки проектов', 'error');
    }
}

function renderProjects() {
    const grid = document.getElementById('projectsGrid');
    const emptyState = document.getElementById('noProjects');

    if (projects.length === 0) {
        grid.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }

    grid.style.display = 'grid';
    emptyState.style.display = 'none';

    grid.innerHTML = projects.map(project => `
        <div class="project-card" data-project-id="${project.id}">
            <div class="project-card-header">
                <div>
                    <div class="project-name">${escapeHtml(project.name)}</div>
                    <div class="project-domain">${escapeHtml(project.domain)}</div>
                </div>
                <button class="project-edit-btn" onclick="showEditProjectModal('${project.id}')">⚙️</button>
            </div>
            <div class="project-stats">
                <div class="project-stat">
                    <div class="project-stat-value">${project.products_count || 0}</div>
                    <div class="project-stat-label">Товаров</div>
                </div>
                <div class="project-stat">
                    <div class="project-stat-value">${project.searches_today || 0}</div>
                    <div class="project-stat-label">Поисков</div>
                </div>
                <div class="project-stat">
                    <div class="project-stat-value">${project.feed_status || '—'}</div>
                    <div class="project-stat-label">Фид</div>
                </div>
            </div>
            <div class="project-api-key">
                <code>${project.api_key}</code>
                <button class="btn-copy-small" onclick="copyToClipboard('${project.api_key}')" title="Копировать">📋</button>
            </div>
        </div>
    `).join('');
}

function populateProjectSelectors() {
    const selectors = [
        'productsProjectSelect',
        'analyticsProjectSelect',
        'widgetProjectSelect',
        'embedProjectSelect'
    ];

    selectors.forEach(selectorId => {
        const select = document.getElementById(selectorId);
        if (select) {
            const currentValue = select.value;
            select.innerHTML = '<option value="">Выберите проект</option>' + 
                projects.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
            if (currentValue && projects.find(p => p.id === currentValue)) {
                select.value = currentValue;
            }
        }
    });
}

function showCreateProjectModal() {
    document.getElementById('projectName').value = '';
    document.getElementById('projectDomain').value = '';
    document.getElementById('projectFeedUrl').value = '';
    document.getElementById('createProjectModal').classList.add('active');
}

function showEditProjectModal(projectId) {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    document.getElementById('editProjectId').value = project.id;
    document.getElementById('editProjectName').value = project.name;
    document.getElementById('editProjectDomain').value = project.domain;
    document.getElementById('editProjectFeedUrl').value = project.feed_url || '';
    document.getElementById('editProjectModal').classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

async function createProject() {
    const name = document.getElementById('projectName').value.trim();
    const domain = document.getElementById('projectDomain').value.trim();
    const feedUrl = document.getElementById('projectFeedUrl').value.trim();

    if (!name || !domain) {
        showToast('Заполните обязательные поля', 'error');
        return;
    }

    try {
        const project = await API.createProject({ name, domain, feed_url: feedUrl || null });
        projects.push(project);
        renderProjects();
        populateProjectSelectors();
        closeModal('createProjectModal');
        showToast('Проект создан', 'success');

        // Load feed if URL provided
        if (feedUrl) {
            loadFeedForProject(project.id, feedUrl);
        }
    } catch (error) {
        showToast('Ошибка создания проекта', 'error');
    }
}

async function updateProject() {
    const id = document.getElementById('editProjectId').value;
    const name = document.getElementById('editProjectName').value.trim();
    const domain = document.getElementById('editProjectDomain').value.trim();
    const feedUrl = document.getElementById('editProjectFeedUrl').value.trim();

    if (!name || !domain) {
        showToast('Заполните обязательные поля', 'error');
        return;
    }

    try {
        const updated = await API.updateProject(id, { name, domain, feed_url: feedUrl || null });
        const index = projects.findIndex(p => p.id === id);
        if (index !== -1) {
            projects[index] = { ...projects[index], ...updated };
        }
        renderProjects();
        populateProjectSelectors();
        closeModal('editProjectModal');
        showToast('Проект обновлён', 'success');
    } catch (error) {
        showToast('Ошибка обновления проекта', 'error');
    }
}

async function deleteProject() {
    const id = document.getElementById('editProjectId').value;
    
    if (!confirm('Вы уверены, что хотите удалить этот проект? Все данные будут потеряны.')) {
        return;
    }

    try {
        await API.deleteProject(id);
        projects = projects.filter(p => p.id !== id);
        renderProjects();
        populateProjectSelectors();
        closeModal('editProjectModal');
        showToast('Проект удалён', 'success');
    } catch (error) {
        showToast('Ошибка удаления проекта', 'error');
    }
}

// Products
async function loadProducts() {
    const projectId = document.getElementById('productsProjectSelect').value;
    
    if (!projectId) {
        document.getElementById('feedControls').style.display = 'none';
        document.getElementById('productsStats').style.display = 'none';
        document.getElementById('productsTableBody').innerHTML = '';
        return;
    }

    currentProject = projects.find(p => p.id === projectId);
    document.getElementById('feedControls').style.display = 'block';
    document.getElementById('feedUrlInput').value = currentProject?.feed_url || '';

    try {
        // Get feed status
        await updateFeedStatus(projectId);

        // Get products
        const response = await API.getProducts(projectId, currentPage, productsPerPage);
        products = response.products || [];
        
        document.getElementById('productsStats').style.display = 'flex';
        document.getElementById('totalProducts').textContent = response.total || 0;
        document.getElementById('indexedProducts').textContent = response.indexed || 0;
        document.getElementById('lastUpdate').textContent = response.last_update ? 
            new Date(response.last_update).toLocaleDateString('ru') : '—';

        renderProducts();
        renderPagination(response.total || 0);
    } catch (error) {
        console.error('Error loading products:', error);
        showToast('Ошибка загрузки товаров', 'error');
    }
}

function renderProducts() {
    const tbody = document.getElementById('productsTableBody');
    
    if (products.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; padding: 40px; color: #6b7280;">
                    Товары не найдены. Загрузите фид для добавления товаров.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = products.map(product => `
        <tr>
            <td>
                <img src="${product.image || ''}" 
                     alt="${escapeHtml(product.name)}" 
                     class="product-image"
                     onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIHZpZXdCb3g9IjAgMCA1MCA1MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIGZpbGw9IiNFNUU3RUIiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iIzlDQTNCOCIgZm9udC1zaXplPSIxMCI+Tm8gaW1nPC90ZXh0Pjwvc3ZnPg=='">
            </td>
            <td><span class="product-name">${escapeHtml(product.name)}</span></td>
            <td><span class="product-price">${formatPrice(product.price)} ₽</span></td>
            <td><span class="product-category">${escapeHtml(product.category || '—')}</span></td>
            <td>
                <span class="product-availability ${product.available ? 'in-stock' : 'out-of-stock'}">
                    ${product.available ? 'В наличии' : 'Нет в наличии'}
                </span>
            </td>
        </tr>
    `).join('');
}

function renderPagination(total) {
    const pagination = document.getElementById('productsPagination');
    const totalPages = Math.ceil(total / productsPerPage);

    if (totalPages <= 1) {
        pagination.innerHTML = '';
        return;
    }

    let html = '';
    html += `<button onclick="changePage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>&lt;</button>`;
    
    for (let i = 1; i <= Math.min(totalPages, 7); i++) {
        html += `<button onclick="changePage(${i})" class="${i === currentPage ? 'active' : ''}">${i}</button>`;
    }
    
    if (totalPages > 7) {
        html += `<button disabled>...</button>`;
        html += `<button onclick="changePage(${totalPages})" class="${totalPages === currentPage ? 'active' : ''}">${totalPages}</button>`;
    }
    
    html += `<button onclick="changePage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>&gt;</button>`;
    
    pagination.innerHTML = html;
}

function changePage(page) {
    currentPage = page;
    loadProducts();
}

function filterProducts() {
    const query = document.getElementById('productsSearchInput').value.toLowerCase();
    const rows = document.querySelectorAll('#productsTableBody tr');
    
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(query) ? '' : 'none';
    });
}

async function updateFeedStatus(projectId) {
    try {
        const status = await API.getFeedStatus(projectId);
        const statusEl = document.getElementById('feedStatusValue');
        
        if (status.status === 'loading') {
            statusEl.textContent = 'Загрузка...';
            statusEl.className = 'status-value loading';
        } else if (status.status === 'success') {
            statusEl.textContent = `Загружено (${status.products_count} товаров)`;
            statusEl.className = 'status-value success';
        } else if (status.status === 'error') {
            statusEl.textContent = 'Ошибка загрузки';
            statusEl.className = 'status-value error';
        } else {
            statusEl.textContent = 'Не загружен';
            statusEl.className = 'status-value';
        }
    } catch (error) {
        console.error('Error getting feed status:', error);
    }
}

async function loadFeed() {
    const projectId = document.getElementById('productsProjectSelect').value;
    const feedUrl = document.getElementById('feedUrlInput').value.trim();

    if (!projectId || !feedUrl) {
        showToast('Укажите URL фида', 'error');
        return;
    }

    await loadFeedForProject(projectId, feedUrl);
}

async function loadFeedForProject(projectId, feedUrl) {
    try {
        document.getElementById('feedStatusValue').textContent = 'Загрузка...';
        document.getElementById('feedStatusValue').className = 'status-value loading';

        await API.loadFeed(projectId, feedUrl);
        showToast('Загрузка фида запущена', 'success');

        // Poll for status
        const pollStatus = setInterval(async () => {
            const status = await API.getFeedStatus(projectId);
            if (status.status !== 'loading') {
                clearInterval(pollStatus);
                await loadProducts();
                await loadProjects(); // Update project stats
            }
        }, 2000);

    } catch (error) {
        document.getElementById('feedStatusValue').textContent = 'Ошибка';
        document.getElementById('feedStatusValue').className = 'status-value error';
        showToast('Ошибка загрузки фида', 'error');
    }
}

async function refreshFeed() {
    const projectId = document.getElementById('productsProjectSelect').value;
    if (!projectId) return;

    const project = projects.find(p => p.id === projectId);
    if (project?.feed_url) {
        await loadFeedForProject(projectId, project.feed_url);
    } else {
        showToast('URL фида не задан', 'error');
    }
}

// Analytics
function initPeriodButtons() {
    const buttons = document.querySelectorAll('.period-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            loadAnalytics();
        });
    });
}

async function loadAnalytics() {
    const projectId = document.getElementById('analyticsProjectSelect').value;
    if (!projectId) return;

    const period = document.querySelector('.period-btn.active')?.dataset.period || 7;

    try {
        const analytics = await API.getAnalytics(projectId, period);
        
        document.getElementById('totalSearches').textContent = analytics.total_searches || 0;
        document.getElementById('totalClicks').textContent = analytics.total_clicks || 0;
        document.getElementById('avgResponseTime').textContent = `${analytics.avg_response_time || 0} мс`;
        
        const conversion = analytics.total_searches > 0 
            ? Math.round((analytics.total_clicks / analytics.total_searches) * 100) 
            : 0;
        document.getElementById('conversionRate').textContent = `${conversion}%`;

        // Popular queries
        const popularContainer = document.getElementById('popularQueries');
        if (analytics.popular_queries?.length > 0) {
            popularContainer.innerHTML = analytics.popular_queries.map(q => `
                <span class="query-tag">
                    ${escapeHtml(q.query)}
                    <span class="query-count">${q.count}</span>
                </span>
            `).join('');
        } else {
            popularContainer.innerHTML = '<div class="empty-state-inline">Нет данных</div>';
        }

        // Zero results queries
        const zeroContainer = document.getElementById('zeroResults');
        if (analytics.zero_results?.length > 0) {
            zeroContainer.innerHTML = analytics.zero_results.map(q => `
                <span class="zero-result-tag">${escapeHtml(q.query)}</span>
            `).join('');
        } else {
            zeroContainer.innerHTML = '<div class="empty-state-inline">Нет данных</div>';
        }

        // Chart
        renderSearchesChart(analytics.searches_by_day || []);

    } catch (error) {
        console.error('Error loading analytics:', error);
        showToast('Ошибка загрузки аналитики', 'error');
    }
}

function renderSearchesChart(data) {
    const container = document.getElementById('searchesChart');
    
    if (data.length === 0) {
        container.innerHTML = '<div class="empty-state-inline">Нет данных для отображения</div>';
        return;
    }

    // Simple bar chart with CSS
    const maxValue = Math.max(...data.map(d => d.count), 1);
    
    container.innerHTML = `
        <div style="display: flex; align-items: flex-end; gap: 8px; height: 200px; padding: 20px 0;">
            ${data.map(d => `
                <div style="flex: 1; display: flex; flex-direction: column; align-items: center;">
                    <div style="
                        width: 100%;
                        height: ${(d.count / maxValue) * 150}px;
                        background: #2563eb;
                        border-radius: 4px 4px 0 0;
                        min-height: 4px;
                    "></div>
                    <div style="font-size: 10px; color: #6b7280; margin-top: 8px; writing-mode: vertical-rl; transform: rotate(180deg);">
                        ${d.date}
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

// Widget Settings
async function loadWidgetSettings() {
    const projectId = document.getElementById('widgetProjectSelect').value;
    if (!projectId) return;

    try {
        const config = await API.getWidgetConfig(projectId);
        
        document.getElementById('widgetTheme').value = config.theme || 'light';
        document.getElementById('widgetPrimaryColor').value = config.primary_color || '#2563eb';
        document.getElementById('widgetTextColor').value = config.text_color || '#1f2937';
        document.getElementById('widgetBgColor').value = config.bg_color || '#ffffff';
        document.getElementById('widgetBorderRadius').value = config.border_radius || 8;
        document.getElementById('borderRadiusValue').textContent = config.border_radius || 8;
        document.getElementById('widgetPlaceholder').value = config.placeholder || 'Поиск товаров...';
        document.getElementById('widgetResultsPerPage').value = config.results_per_page || 10;
        document.getElementById('widgetShowImages').checked = config.show_images !== false;
        document.getElementById('widgetShowPrices').checked = config.show_prices !== false;
        document.getElementById('widgetShowSuggestions').checked = config.show_suggestions !== false;

        updateWidgetPreview();
    } catch (error) {
        console.error('Error loading widget config:', error);
    }
}

function updateWidgetPreview() {
    const preview = document.getElementById('previewWidget');
    const theme = document.getElementById('widgetTheme').value;
    const primaryColor = document.getElementById('widgetPrimaryColor').value;
    const textColor = document.getElementById('widgetTextColor').value;
    const bgColor = document.getElementById('widgetBgColor').value;
    const borderRadius = document.getElementById('widgetBorderRadius').value;
    const placeholder = document.getElementById('widgetPlaceholder').value;
    const showImages = document.getElementById('widgetShowImages').checked;
    const showPrices = document.getElementById('widgetShowPrices').checked;

    document.getElementById('borderRadiusValue').textContent = borderRadius;

    preview.style.setProperty('--primary-color', primaryColor);
    preview.style.setProperty('--text-color', textColor);
    preview.style.setProperty('--bg-color', bgColor);
    preview.style.borderRadius = borderRadius + 'px';
    preview.style.background = bgColor;
    preview.style.color = textColor;

    const searchBtn = preview.querySelector('.preview-search-box button');
    if (searchBtn) searchBtn.style.background = primaryColor;

    const input = preview.querySelector('.preview-search-box input');
    if (input) input.placeholder = placeholder;

    const images = preview.querySelectorAll('.preview-result-image');
    images.forEach(img => img.style.display = showImages ? 'block' : 'none');

    const prices = preview.querySelectorAll('.preview-result-price');
    prices.forEach(p => {
        p.style.display = showPrices ? 'block' : 'none';
        p.style.color = primaryColor;
    });

    const container = document.getElementById('widgetPreviewContainer');
    if (theme === 'dark') {
        container.style.background = '#1f2937';
    } else {
        container.style.background = '#f3f4f6';
    }
}

async function saveWidgetSettings() {
    const projectId = document.getElementById('widgetProjectSelect').value;
    if (!projectId) {
        showToast('Выберите проект', 'error');
        return;
    }

    const config = {
        theme: document.getElementById('widgetTheme').value,
        primary_color: document.getElementById('widgetPrimaryColor').value,
        text_color: document.getElementById('widgetTextColor').value,
        bg_color: document.getElementById('widgetBgColor').value,
        border_radius: parseInt(document.getElementById('widgetBorderRadius').value),
        placeholder: document.getElementById('widgetPlaceholder').value,
        results_per_page: parseInt(document.getElementById('widgetResultsPerPage').value),
        show_images: document.getElementById('widgetShowImages').checked,
        show_prices: document.getElementById('widgetShowPrices').checked,
        show_suggestions: document.getElementById('widgetShowSuggestions').checked
    };

    try {
        await API.updateWidgetConfig(projectId, config);
        showToast('Настройки сохранены', 'success');
    } catch (error) {
        showToast('Ошибка сохранения настроек', 'error');
    }
}

// Embed Section
function updateEmbedCode() {
    const projectId = document.getElementById('embedProjectSelect').value;
    const embedContent = document.getElementById('embedContent');
    const noProject = document.getElementById('noEmbedProject');

    if (!projectId) {
        embedContent.style.display = 'none';
        noProject.style.display = 'block';
        return;
    }

    embedContent.style.display = 'block';
    noProject.style.display = 'none';

    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    const apiKey = project.api_key;
    document.getElementById('projectApiKey').textContent = apiKey;

    // Update script code
    const scriptCode = document.getElementById('embedScriptCode');
    scriptCode.textContent = `<script src="/api/v1/widget/embed.js" data-api-key="${apiKey}"></script>`;

    // Update advanced code
    const advancedCode = document.getElementById('embedAdvancedCode');
    advancedCode.textContent = `<script>
window.SearchProConfig = {
    apiKey: '${apiKey}',
    container: '#searchpro-widget',
    placeholder: 'Найти товар...',
    theme: 'light',
    showImages: true,
    showPrices: true,
    resultsPerPage: 10,
    onSearch: function(query, results) {
        console.log('Поиск:', query, results);
    },
    onSelect: function(product) {
        window.location.href = product.url;
    }
};
</script>
<script src="/api/v1/widget/embed.js"></script>`;
}

async function testSearch() {
    const projectId = document.getElementById('embedProjectSelect').value;
    const query = document.getElementById('testSearchInput').value.trim();

    if (!projectId || !query) {
        showToast('Введите поисковый запрос', 'error');
        return;
    }

    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    try {
        const results = await API.search(project.api_key, query);
        renderTestResults(results.products || []);
    } catch (error) {
        showToast('Ошибка поиска', 'error');
    }
}

function renderTestResults(results) {
    const container = document.getElementById('testResults');
    
    if (results.length === 0) {
        container.innerHTML = '<div class="empty-state-inline">Ничего не найдено</div>';
        return;
    }

    container.innerHTML = results.slice(0, 10).map(product => `
        <div class="test-result-item">
            <img src="${product.image || ''}" 
                 alt="${escapeHtml(product.name)}" 
                 class="test-result-image"
                 onerror="this.style.background='#f3f4f6'">
            <div class="test-result-content">
                <div class="test-result-title">${escapeHtml(product.name)}</div>
                <div class="test-result-price">${formatPrice(product.price)} ₽</div>
            </div>
        </div>
    `).join('');
}

function copyApiKey() {
    const apiKey = document.getElementById('projectApiKey').textContent;
    copyToClipboard(apiKey);
}

function copyCode(elementId) {
    const code = document.getElementById(elementId).textContent;
    copyToClipboard(code);
}

// Utilities
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('Скопировано!', 'success');
    }).catch(() => {
        showToast('Не удалось скопировать', 'error');
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

function formatPrice(price) {
    return new Intl.NumberFormat('ru-RU').format(price || 0);
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');
    
    toastMessage.textContent = message;
    toast.className = `toast show ${type}`;
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Handle Enter key in test search
document.addEventListener('keyup', (e) => {
    if (e.target.id === 'testSearchInput' && e.key === 'Enter') {
        testSearch();
    }
});
