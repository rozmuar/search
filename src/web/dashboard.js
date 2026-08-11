/**
 * SearchPro Dashboard - Modern UI
 */

// ==================== CONSTANTS ====================
const API_BASE = window.location.origin;
let currentUser = null;
let projects = [];
let currentProject = null;
let products = [];
let productsTotal = 0;
let productsPage = 1;
const productsPerPage = 15;
const PRODUCTS_FETCH_LIMIT = 500; // максимум, который отдаёт /projects/{id}/products (le=500)

// Charts
let searchChart = null;
let analyticsChart = null;

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', async () => {
    // Check auth
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '/auth.html';
        return;
    }

    // Load user
    try {
        const response = await fetch(`${API_BASE}/api/v1/auth/me`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) {
            throw new Error('Unauthorized');
        }
        
        currentUser = await response.json();
        updateUserUI();
    } catch (err) {
        console.error('Auth error:', err);
        localStorage.removeItem('token');
        window.location.href = '/auth.html';
        return;
    }

    // Setup navigation
    setupNavigation();

    // Setup recommendations product search (static DOM elements, one-time listener setup)
    initRecsProductSearch();

    // Load initial data
    await loadProjects();
    loadDashboardStats();
    initCharts();

    // Notifications - poll every 30s, closes on outside click
    loadNotifications();
    setInterval(loadNotifications, 30000);
    document.addEventListener('click', (e) => {
        const wrapper = document.querySelector('.notif-wrapper');
        if (wrapper && !wrapper.contains(e.target)) {
            document.getElementById('notifDropdown').style.display = 'none';
        }
    });

    // Handle initial URL
    handleRoute();
});

// ==================== USER UI ====================
function updateUserUI() {
    if (!currentUser) return;

    const email = currentUser.email || 'user@example.com';
    const name = email.split('@')[0];
    const initial = name.charAt(0).toUpperCase();

    document.getElementById('userName').textContent = name;
    document.getElementById('userAvatar').textContent = initial;

    const navSectionAdmin = document.getElementById('navSectionAdmin');
    if (navSectionAdmin) {
        navSectionAdmin.style.display = ['admin', 'manager'].includes(currentUser.role) ? '' : 'none';
    }
}

// ==================== NAVIGATION ====================
function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const section = item.dataset.section;
            if (section) {
                navigateTo(section);
            }
        });
    });
    
    // Handle browser back/forward
    window.addEventListener('popstate', () => {
        handleRoute();
    });
}

// URL-based navigation with clean URLs
function navigateTo(sectionId, params = {}) {
    let path = `/dashboard/${sectionId === 'dashboard' ? '' : sectionId + '/'}`;
    
    // Add params if any (e.g., project ID)
    if (params.id) {
        path = `/dashboard/project/${params.id}/`;
    }
    
    history.pushState({ section: sectionId, params }, '', path);
    handleRoute();
}

function handleRoute() {
    const path = window.location.pathname;
    
    // Parse path: /dashboard/section/ or /dashboard/project/id/
    const match = path.match(/^\/dashboard\/?(.*)$/);
    if (!match) {
        showSection('dashboard');
        return;
    }
    
    const parts = match[1].split('/').filter(Boolean);
    
    if (parts.length === 0) {
        showSection('dashboard');
    } else if (parts[0] === 'project' && parts[1]) {
        // Project detail: /dashboard/project/{id}/
        openProjectDetail(parts[1]);
    } else {
        // Regular section: /dashboard/{section}/
        showSection(parts[0]);
    }
}

function showSection(sectionId) {
    // Update nav
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.section === sectionId);
    });
    
    // Update sections
    document.querySelectorAll('.content-section').forEach(section => {
        section.classList.toggle('active', section.id === `section-${sectionId}`);
    });
    
    // Update page title
    const titles = {
        'dashboard': 'Дашборд',
        'projects': 'Проекты',
        'products': 'Товары',
        'analytics': 'Аналитика',
        'widget': 'Виджет',
        'embed': 'Встраивание',
        'project-detail': 'Проект',
        'feed-guide': 'Формат фида',
        'admin': 'Администрирование'
    };
    document.getElementById('pageTitle').textContent = titles[sectionId] || 'Дашборд';
    
    // Update browser title
    document.title = `${titles[sectionId] || 'Дашборд'} — SearchPro`;
    
    // Section-specific actions
    if (sectionId === 'products') {
        updateProjectSelect('productsProjectSelect');
    } else if (sectionId === 'analytics') {
        updateProjectSelect('analyticsProjectSelect');
        loadAnalytics();
    } else if (sectionId === 'widget') {
        updateProjectSelect('widgetProjectSelect');
    } else if (sectionId === 'embed') {
        updateProjectSelect('embedProjectSelect');
        updateEmbedCode();
    } else if (sectionId === 'admin') {
        loadAdminProjects();
        loadAdminUsers();
        loadPaymentRequisites();
    }

    // Close mobile sidebar
    closeSidebar();
}

// ==================== SIDEBAR ====================
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebarOverlay').classList.toggle('show');
}

function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('show');
}

// ==================== PROJECTS ====================
async function loadProjects() {
    try {
        const response = await fetchAPI('/api/v1/projects');
        // API returns {projects: [...]} or just array
        projects = Array.isArray(response) ? response : (response.projects || []);
        
        renderProjectsList();
        renderDashboardProjects();
        updateAllProjectSelects();
        
        // Show empty state if no projects
        document.getElementById('noProjects').style.display = projects.length === 0 ? 'block' : 'none';
        document.getElementById('projectsList').style.display = projects.length > 0 ? 'block' : 'none';
        
    } catch (err) {
        console.error('Error loading projects:', err);
        showToast('Ошибка загрузки проектов', 'error');
    }
}

function renderProjectsList() {
    const container = document.getElementById('projectsList');
    if (!Array.isArray(projects) || projects.length === 0) {
        container.innerHTML = '';
        return;
    }
    
    const colors = ['blue', 'green', 'orange', 'red', 'purple'];
    
    container.innerHTML = projects.map((p, i) => `
        <div class="project-item ${currentProject?.id === p.id ? 'selected' : ''}" 
             onclick="selectProject('${p.id}')">
            <div class="project-icon ${colors[i % colors.length]}">📁</div>
            <div class="project-info">
                <div class="project-name">${escapeHtml(p.name)}</div>
                <div class="project-domain">${escapeHtml(p.domain || 'Без домена')}</div>
            </div>
            <div class="project-actions">
                <button class="btn-icon" onclick="event.stopPropagation(); editProject('${p.id}')" title="Редактировать">✏️</button>
                <button class="btn-icon" onclick="event.stopPropagation(); deleteProject('${p.id}')" title="Удалить">🗑️</button>
            </div>
            <div class="project-stats">
                <div class="project-products-count">${p.products_count || 0}</div>
                <div class="project-searches-count">${p.searches_count || 0} поисков</div>
            </div>
        </div>
    `).join('');
}

function renderDashboardProjects() {
    const container = document.getElementById('dashboardProjectsList');
    
    if (!Array.isArray(projects) || projects.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="border: none; margin: 20px;">
                <div class="empty-icon">📁</div>
                <p class="empty-text">Нет проектов</p>
                <button class="btn btn-primary btn-sm" onclick="showCreateProjectModal()">Создать</button>
            </div>
        `;
        return;
    }
    
    const colors = ['blue', 'green', 'orange', 'red', 'purple'];
    const displayProjects = projects.slice(0, 5);
    
    container.innerHTML = displayProjects.map((p, i) => `
        <div class="project-item" onclick="openProjectDetail('${p.id}')">
            <div class="project-icon ${colors[i % colors.length]}">📁</div>
            <div class="project-info">
                <div class="project-name">${escapeHtml(p.name)}</div>
                <div class="project-domain">${escapeHtml(p.domain || 'Без домена')}</div>
            </div>
            <div class="project-stats">
                <div class="project-products-count">${p.products_count || 0}</div>
                <div class="project-searches-count">товаров</div>
            </div>
        </div>
    `).join('');
}

function selectProject(projectId) {
    currentProject = projects.find(p => p.id === projectId);
    renderProjectsList();
    openProjectDetail(projectId);
}

function updateProjectSelect(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;
    
    const currentValue = select.value;
    
    select.innerHTML = '<option value="">Выберите проект</option>' + 
        projects.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    
    if (currentValue && projects.find(p => p.id === currentValue)) {
        select.value = currentValue;
    }
}

function updateAllProjectSelects() {
    ['productsProjectSelect', 'analyticsProjectSelect', 'widgetProjectSelect', 'embedProjectSelect']
        .forEach(id => updateProjectSelect(id));
}

// ==================== CREATE PROJECT ====================
let editingProjectId = null;

function showCreateProjectModal() {
    editingProjectId = null;
    document.getElementById('modalTitle').textContent = 'Создать проект';
    document.getElementById('projectSubmitBtn').textContent = 'Создать';
    document.getElementById('createProjectModal').classList.add('active');
    document.getElementById('projectName').value = '';
    document.getElementById('projectDomain').value = '';
    document.getElementById('projectFeedUrlInput').value = '';
    document.getElementById('projectName').focus();
}

function closeCreateProjectModal() {
    document.getElementById('createProjectModal').classList.remove('active');
}

async function createProject() {
    const name = document.getElementById('projectName').value.trim();
    const domain = document.getElementById('projectDomain').value.trim();
    const feedUrl = document.getElementById('projectFeedUrlInput').value.trim();
    
    if (!name) {
        showToast('Введите название проекта', 'error');
        return;
    }
    
    try {
        const data = { name, domain };
        if (feedUrl) data.feed_url = feedUrl;
        
        if (editingProjectId) {
            // Update existing project
            await fetchAPI(`/api/v1/projects/${editingProjectId}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
            showToast('Проект обновлён', 'success');
        } else {
            // Create new project
            await fetchAPI('/api/v1/projects', {
                method: 'POST',
                body: JSON.stringify(data)
            });
            showToast('Проект создан', 'success');
        }
        
        closeCreateProjectModal();
        await loadProjects();
        loadDashboardStats();
        
    } catch (err) {
        showToast(err.message || 'Ошибка сохранения проекта', 'error');
    }
}

function editProject(projectId) {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;
    
    editingProjectId = projectId;
    document.getElementById('modalTitle').textContent = 'Редактировать проект';
    document.getElementById('projectSubmitBtn').textContent = 'Сохранить';
    document.getElementById('createProjectModal').classList.add('active');
    document.getElementById('projectName').value = project.name || '';
    document.getElementById('projectDomain').value = project.domain || '';
    document.getElementById('projectFeedUrlInput').value = project.feed_url || '';
    document.getElementById('projectName').focus();
}

async function deleteProject(projectId) {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;
    
    if (!confirm(`Удалить проект "${project.name}"? Это действие нельзя отменить.`)) {
        return;
    }
    
    try {
        await fetchAPI(`/api/v1/projects/${projectId}`, {
            method: 'DELETE'
        });
        showToast('Проект удалён', 'success');
        await loadProjects();
        loadDashboardStats();
        
        // If we were on project detail page, go back to projects list
        if (currentProject?.id === projectId) {
            currentProject = null;
            showSection('projects');
        }
    } catch (err) {
        showToast(err.message || 'Ошибка удаления проекта', 'error');
    }
}

// ==================== PROJECT DETAIL ====================
let apiKeyVisible = false;

// Показывает дату окончания оплаты и баннер (приостановлен / скоро закончится) на
// странице проекта. Реальная блокировка изменений - на бэкенде (403 у suspended
// проекта), здесь только информирование, чтобы клиент понимал, что происходит.
function renderBillingBanner(project) {
    const paidUntilEl = document.getElementById('projectDetailPaidUntil');
    const bannerEl = document.getElementById('billingBanner');
    const bannerTextEl = document.getElementById('billingBannerText');

    if (project.paid_until) {
        const formatted = new Date(project.paid_until).toLocaleDateString('ru-RU', { timeZone: 'UTC' });
        paidUntilEl.textContent = `Оплачено до: ${formatted}`;
        paidUntilEl.style.display = '';
    } else {
        paidUntilEl.style.display = 'none';
    }

    if (project.status === 'suspended') {
        bannerEl.className = 'billing-banner danger';
        bannerTextEl.textContent = 'Проект приостановлен — оплата не поступила. Изменение настроек недоступно, поиск на сайте отключён. Свяжитесь с поддержкой для возобновления работы.';
        bannerEl.style.display = 'flex';
        return;
    }

    if (project.paid_until) {
        const msPerDay = 24 * 60 * 60 * 1000;
        const today = new Date(new Date().toISOString().slice(0, 10));
        const paidUntilDate = new Date(project.paid_until);
        const daysLeft = Math.round((paidUntilDate - today) / msPerDay);

        if (daysLeft <= 7) {
            const formatted = paidUntilDate.toLocaleDateString('ru-RU', { timeZone: 'UTC' });
            bannerEl.className = 'billing-banner warning';
            bannerTextEl.textContent = daysLeft >= 0
                ? `Оплата заканчивается ${formatted} (осталось ${daysLeft} дн.). Продлите оплату, чтобы поиск не отключился.`
                : `Оплата закончилась ${formatted}. Проект скоро будет приостановлен.`;
            bannerEl.style.display = 'flex';
            return;
        }
    }

    bannerEl.style.display = 'none';
}

async function openProjectDetail(projectId) {
    // If called from click, update URL
    const expectedPath = `/dashboard/project/${projectId}/`;
    if (window.location.pathname !== expectedPath) {
        history.pushState({ section: 'project', params: { id: projectId } }, '', expectedPath);
    }
    
    const project = projects.find(p => p.id === projectId);
    if (!project) {
        // Project not found, go to projects list
        navigateTo('projects');
        return;
    }

    // Подтягиваем свежие status/paid_until с сервера - планировщик биллинга мог
    // приостановить проект в фоне уже после того, как список проектов был загружен
    // (или пока эта вкладка дашборда просто была открыта). Без этого баннер мог бы
    // показывать "скоро закончится", когда бэкенд уже реально блокирует поиск.
    // Object.assign, а не замена ссылки - тот же объект остаётся в массиве projects.
    try {
        const fresh = await fetchAPI(`/api/v1/projects/${projectId}`);
        Object.assign(project, fresh);
    } catch (err) {
        console.error('Error refreshing project before showing detail:', err);
    }

    currentProject = project;

    // Update UI
    document.getElementById('projectDetailName').textContent = project.name;
    document.getElementById('projectDetailDomain').textContent = project.domain || 'Домен не указан';
    renderBillingBanner(project);

    // Stats
    document.getElementById('projectStatProducts').textContent = project.products_count || 0;
    document.getElementById('projectStatSearches').textContent = project.searches_count || 0;
    document.getElementById('projectStatCategories').textContent = project.categories_count || 0;
    
    // Feed URL
    const feedUrl = project.feed_url;
    const feedUrlEl = document.getElementById('projectFeedUrl');
    if (feedUrl) {
        feedUrlEl.innerHTML = `<a href="${escapeHtml(feedUrl)}" target="_blank" class="feed-url-text">${escapeHtml(feedUrl)}</a>`;
    } else {
        feedUrlEl.innerHTML = '<span class="feed-url-text" style="color: var(--gray-400);">Не указан — добавьте в настройках проекта</span>';
    }
    
    // API Key (hidden by default)
    apiKeyVisible = false;
    document.getElementById('projectApiKey').textContent = '••••••••••••••••';
    
    // Show section
    showSection('project-detail');
    
    // Load feed status
    await loadProjectFeedStatus();

    // Load search settings
    await loadSearchSettings();

    // Load cart callback settings
    await loadCartSettings();

    // Load recommendations settings
    await loadRecommendationsSettings();

    // Load synonyms
    await loadSynonyms();
    
    // Load project statistics
    await loadProjectStatistics();
}

async function loadProjectFeedStatus() {
    if (!currentProject) return;
    
    const statusBadge = document.getElementById('projectFeedStatus');
    const loadBtn = document.getElementById('projectLoadFeedBtn');
    const refreshBtn = document.getElementById('projectRefreshFeedBtn');
    const resultContainer = document.getElementById('feedResultContainer');
    const autoUpdateInfo = document.getElementById('autoUpdateInfo');
    
    try {
        const status = await fetchAPI(`/api/v1/projects/${currentProject.id}/feed/status`);
        
        if (status.status === 'loaded' || status.status === 'success' || status.products_count > 0) {
            statusBadge.className = 'feed-status-badge success';
            statusBadge.innerHTML = '<span class="status-dot success"></span><span>Загружен</span>';
            
            loadBtn.style.display = 'none';
            refreshBtn.style.display = 'inline-flex';
            
            // Show result
            resultContainer.style.display = 'block';
            document.getElementById('feedResultProducts').textContent = status.products_count || 0;
            document.getElementById('feedResultCategories').textContent = status.categories_count || 0;
            
            const lastUpdate = status.last_update ? new Date(status.last_update).toLocaleString('ru') : '—';
            document.getElementById('feedResultTime').textContent = lastUpdate;
            document.getElementById('projectStatUpdated').textContent = lastUpdate.split(',')[0] || '—';
            
            // Show auto-update info
            if (autoUpdateInfo) {
                let autoUpdateHtml = '<div class="auto-update-status">';
                autoUpdateHtml += '<span class="auto-update-icon">🔄</span>';
                autoUpdateHtml += '<span>Автообновление: каждые 4 часа</span>';
                
                if (status.last_auto_update) {
                    const lastAutoUpdate = new Date(status.last_auto_update).toLocaleString('ru');
                    autoUpdateHtml += `<span class="auto-update-time">Последнее: ${lastAutoUpdate}</span>`;
                    
                    if (status.auto_update_status === 'success') {
                        autoUpdateHtml += '<span class="auto-update-badge success">✓</span>';
                    } else if (status.auto_update_status === 'error') {
                        autoUpdateHtml += `<span class="auto-update-badge error" title="${status.auto_update_error || 'Ошибка'}">✗</span>`;
                    }
                }
                
                autoUpdateHtml += '</div>';
                autoUpdateInfo.innerHTML = autoUpdateHtml;
                autoUpdateInfo.style.display = 'block';
            }
        } else if (status.status === 'updating') {
            statusBadge.className = 'feed-status-badge loading';
            statusBadge.innerHTML = '<span class="status-dot"></span><span>Обновляется...</span>';
            loadBtn.style.display = 'none';
            refreshBtn.style.display = 'none';
        } else {
            statusBadge.className = 'feed-status-badge';
            statusBadge.innerHTML = '<span class="status-dot neutral"></span><span>Не загружен</span>';
            loadBtn.style.display = 'inline-flex';
            refreshBtn.style.display = 'none';
            resultContainer.style.display = 'none';
            document.getElementById('projectStatUpdated').textContent = '—';
            if (autoUpdateInfo) autoUpdateInfo.style.display = 'none';
        }
    } catch (err) {
        console.error('Error loading feed status:', err);
        statusBadge.className = 'feed-status-badge';
        statusBadge.innerHTML = '<span class="status-dot neutral"></span><span>Неизвестно</span>';
    }
}

// ==================== SEARCH SETTINGS ====================
let searchSettingsChanged = false;

function parseFieldListSetting(rawValue) {
    let value = rawValue;
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        } catch (e) {
            return [];
        }
    }
    return Array.isArray(value) ? value : [];
}

async function loadSearchSettings() {
    if (!currentProject) return;

    const container = document.getElementById('relatedProductsFields');
    const facetContainer = document.getElementById('facetFieldsList');
    const limitInput = document.getElementById('relatedProductsLimit');
    const saveBtn = document.getElementById('saveSearchSettingsBtn');
    const statusEl = document.getElementById('searchSettingsStatus');

    if (!container || !limitInput) return;

    // Reset
    container.innerHTML = '<div class="form-hint">Загрузка параметров...</div>';
    if (facetContainer) facetContainer.innerHTML = '<div class="form-hint">Загрузка параметров...</div>';
    searchSettingsChanged = false;
    saveBtn.disabled = true;
    statusEl.textContent = '';

    let selectedFields = [];
    let selectedFacetFields = [];

    try {
        // Load current settings first
        let settings = await fetchAPI(`/api/v1/projects/${currentProject.id}/search-settings`);
        console.log('Search settings loaded (raw):', settings, 'type:', typeof settings);

        // Если settings - строка, парсим её
        if (typeof settings === 'string') {
            try {
                settings = JSON.parse(settings);
            } catch (e) {
                console.log('Failed to parse settings:', e);
                settings = {};
            }
        }
        console.log('Search settings parsed:', settings);

        // Поддержка разных форматов (массив или JSON-строка)
        const rawFields = parseFieldListSetting(settings.relatedProductsFields);
        selectedFields = rawFields.length ? rawFields :
                        (settings.relatedProductsField ? [settings.relatedProductsField] : []);
        console.log('Selected fields to check:', selectedFields);

        selectedFacetFields = parseFieldListSetting(settings.facetFields);

        if (settings.relatedProductsLimit) {
            limitInput.value = settings.relatedProductsLimit;
        }
    } catch (err) {
        console.log('No search settings yet:', err);
    }

    try {
        // Load available fields from feed
        const feedParams = await fetchAPI(`/api/v1/projects/${currentProject.id}/feed-params`);
        console.log('Feed params response:', feedParams);

        if (feedParams.fields && feedParams.fields.length > 0) {
            // Common fields first
            const commonFields = ['brand', 'vendor', 'category', 'categoryId', 'model'];
            const sortedFields = [...feedParams.fields].sort((a, b) => {
                const aCommon = commonFields.indexOf(a);
                const bCommon = commonFields.indexOf(b);
                if (aCommon >= 0 && bCommon >= 0) return aCommon - bCommon;
                if (aCommon >= 0) return -1;
                if (bCommon >= 0) return 1;
                return a.localeCompare(b);
            });

            // Render checkboxes
            console.log('Rendering checkboxes, selectedFields:', selectedFields);
            container.innerHTML = sortedFields.map(field => {
                const checked = selectedFields.includes(field) ? 'checked' : '';
                console.log(`Field ${field}, checked: ${checked}`);
                return `
                    <label class="checkbox-item">
                        <input type="checkbox" name="relatedField" value="${field}" ${checked} onchange="markSearchSettingsChanged()">
                        <span>${field}</span>
                    </label>
                `;
            }).join('');

            // Фасеты виджета - только реальные свойства товаров (params.*),
            // не служебные поля типа brand/category (у них уже есть свои фасеты)
            if (facetContainer) {
                const facetFields = sortedFields
                    .filter(f => f.startsWith('params.'))
                    .map(f => f.slice(7));

                if (facetFields.length > 0) {
                    facetContainer.innerHTML = facetFields.map(field => {
                        const checked = selectedFacetFields.includes(field) ? 'checked' : '';
                        return `
                            <label class="checkbox-item">
                                <input type="checkbox" name="facetField" value="${field}" ${checked} onchange="markSearchSettingsChanged()">
                                <span>${field}</span>
                            </label>
                        `;
                    }).join('');
                } else {
                    facetContainer.innerHTML = '<div class="form-hint">В фиде нет параметров товаров (param) - только базовые поля</div>';
                }
            }
        } else {
            container.innerHTML = '<div class="form-hint">Нет доступных параметров. Загрузите фид.</div>';
            if (facetContainer) facetContainer.innerHTML = '<div class="form-hint">Нет доступных параметров. Загрузите фид.</div>';
        }

    } catch (err) {
        console.error('Error loading search settings:', err);
        container.innerHTML = '<div class="form-hint">Сначала загрузите фид</div>';
        if (facetContainer) facetContainer.innerHTML = '<div class="form-hint">Сначала загрузите фид</div>';
    }
}

function markSearchSettingsChanged() {
    searchSettingsChanged = true;
    document.getElementById('saveSearchSettingsBtn').disabled = false;
    document.getElementById('searchSettingsStatus').textContent = 'Есть несохранённые изменения';
}

async function saveSearchSettings() {
    if (!currentProject) return;
    
    const container = document.getElementById('relatedProductsFields');
    const facetContainer = document.getElementById('facetFieldsList');
    const limitInput = document.getElementById('relatedProductsLimit');
    const saveBtn = document.getElementById('saveSearchSettingsBtn');
    const statusEl = document.getElementById('searchSettingsStatus');

    saveBtn.disabled = true;
    statusEl.textContent = 'Сохранение...';

    try {
        // Получаем все отмеченные чекбоксы
        const checkboxes = container.querySelectorAll('input[name="relatedField"]:checked');
        const selectedFields = Array.from(checkboxes).map(cb => cb.value);

        const facetCheckboxes = facetContainer ? facetContainer.querySelectorAll('input[name="facetField"]:checked') : [];
        const selectedFacetFields = Array.from(facetCheckboxes).map(cb => cb.value);

        const settings = {
            relatedProductsFields: selectedFields,
            relatedProductsLimit: parseInt(limitInput.value) || 4
        };

        // facetFields пишем только если что-то выбрано - пустой массив означал бы
        // "явно показывать 0 фасетов", а не "ничего не трогал, пусть определяет
        // автоматически" (см. facet_fields в engine_simple.py: None = автоопределение)
        if (selectedFacetFields.length > 0) {
            settings.facetFields = selectedFacetFields;
        }
        
        console.log('Saving search settings:', settings);
        
        await fetchAPI(`/api/v1/projects/${currentProject.id}/search-settings`, {
            method: 'PUT',
            body: JSON.stringify(settings)
        });
        
        searchSettingsChanged = false;
        statusEl.textContent = '✓ Сохранено';
        showToast('Настройки поиска сохранены', 'success');

        // Update local project data
        currentProject.search_settings = settings;

    } catch (err) {
        console.error('Error saving search settings:', err);
        saveBtn.disabled = false;
        statusEl.textContent = 'Ошибка сохранения';
        showToast('Ошибка сохранения настроек', 'error');
    }
}

// ==================== CART CALLBACK ====================
let cartSettingsChanged = false;

async function loadCartSettings() {
    if (!currentProject) return;

    const input = document.getElementById('projectCartCallbackUrl');
    const saveBtn = document.getElementById('saveCartSettingsBtn');
    const statusEl = document.getElementById('cartSettingsStatus');

    if (!input) return;

    cartSettingsChanged = false;
    saveBtn.disabled = true;
    statusEl.textContent = '';

    try {
        let settings = await fetchAPI(`/api/v1/projects/${currentProject.id}/widget`);
        if (typeof settings === 'string') {
            try { settings = JSON.parse(settings); } catch (e) { settings = {}; }
        }
        input.value = settings.cartCallbackUrl || '';
    } catch (err) {
        console.log('No widget settings yet:', err);
        input.value = '';
    }
}

function markCartSettingsChanged() {
    cartSettingsChanged = true;
    document.getElementById('saveCartSettingsBtn').disabled = false;
    document.getElementById('cartSettingsStatus').textContent = 'Есть несохранённые изменения';
}

async function saveCartSettings() {
    if (!currentProject) return;

    const input = document.getElementById('projectCartCallbackUrl');
    const saveBtn = document.getElementById('saveCartSettingsBtn');
    const statusEl = document.getElementById('cartSettingsStatus');

    saveBtn.disabled = true;
    statusEl.textContent = 'Сохранение...';

    try {
        // PUT /widget делает полную замену - подгружаем текущие настройки (цвета,
        // шрифт и т.д. из вкладки "Настройка виджета"), чтобы их не затереть
        let settings = await fetchAPI(`/api/v1/projects/${currentProject.id}/widget`);
        if (typeof settings === 'string') {
            try { settings = JSON.parse(settings); } catch (e) { settings = {}; }
        }
        settings.cartCallbackUrl = input.value.trim();

        await fetchAPI(`/api/v1/projects/${currentProject.id}/widget`, {
            method: 'PUT',
            body: JSON.stringify(settings)
        });

        cartSettingsChanged = false;
        statusEl.textContent = '✓ Сохранено';
        showToast('Настройки корзины сохранены', 'success');

        const project = projects.find(p => p.id === currentProject.id);
        if (project) {
            project.widget_settings = settings;
        }

    } catch (err) {
        console.error('Error saving cart settings:', err);
        saveBtn.disabled = false;
        statusEl.textContent = 'Ошибка сохранения';
        showToast('Ошибка сохранения настроек', 'error');
    }
}

// ==================== RECOMMENDATIONS ====================
let recsManualPicks = [];       // [{id, name, image, price}]
let recsFilterRules = [];       // [{field, values: []}]
let recsAvailableFields = [];   // ["brand", "params.Цвет", ...] from /feed-params
let recsSettingsChanged = false;
let recsSearchDebounceTimer = null;

async function loadRecommendationsSettings() {
    if (!currentProject) return;
    const limitInput = document.getElementById('recsLimit');
    const saveBtn = document.getElementById('saveRecsSettingsBtn');
    const statusEl = document.getElementById('recsSettingsStatus');
    if (!limitInput) return;

    recsSettingsChanged = false;
    saveBtn.disabled = true;
    statusEl.textContent = '';
    recsManualPicks = [];
    recsFilterRules = [];

    try {
        let settings = await fetchAPI(`/api/v1/projects/${currentProject.id}/search-settings`);
        if (typeof settings === 'string') {
            try { settings = JSON.parse(settings); } catch (e) { settings = {}; }
        }
        const recs = settings.recommendations || {};
        limitInput.value = recs.limit || 8;

        const manualIds = Array.isArray(recs.manualProductIds) ? recs.manualProductIds : [];
        if (manualIds.length > 0) {
            try {
                const data = await fetchAPI(`/api/v1/projects/${currentProject.id}/products/by-ids`, {
                    method: 'POST',
                    body: JSON.stringify({ ids: manualIds })
                });
                recsManualPicks = data.items || [];
            } catch (err) {
                console.error('Error loading manual picks:', err);
            }
        }

        const attributeFilters = recs.attributeFilters || {};
        recsFilterRules = Object.entries(attributeFilters).map(([field, values]) => ({
            field,
            values: Array.isArray(values) ? values : [values]
        }));
    } catch (err) {
        console.log('No recommendations settings yet:', err);
    }

    renderRecsManualPicks();
    renderRecsFilterRules();

    try {
        const feedParams = await fetchAPI(`/api/v1/projects/${currentProject.id}/feed-params`);
        recsAvailableFields = feedParams.fields || [];
        const select = document.getElementById('recsFilterFieldSelect');
        if (select) {
            select.innerHTML = '<option value="">Выберите свойство...</option>' +
                recsAvailableFields.map(f => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('');
        }
    } catch (err) {
        console.error('Error loading feed params for recommendations:', err);
    }

    updateRecsEmbedCode();
}

function markRecsSettingsChanged() {
    recsSettingsChanged = true;
    document.getElementById('saveRecsSettingsBtn').disabled = false;
    document.getElementById('recsSettingsStatus').textContent = 'Есть несохранённые изменения';
}

// ---- Manual product picks ----
function renderRecsManualPicks() {
    const listEl = document.getElementById('recsManualPicksList');
    if (!listEl) return;
    if (recsManualPicks.length === 0) {
        listEl.innerHTML = '<div class="form-hint">Товары не выбраны</div>';
        return;
    }
    listEl.innerHTML = recsManualPicks.map((p, index) => `
        <div class="synonym-group" data-index="${index}">
            <div class="synonym-words">
                <span class="synonym-word">${escapeHtml(p.name || p.id)}${p.price ? ` — ${formatPrice(p.price)} ₽` : ''}</span>
            </div>
            <button class="synonym-delete-btn" onclick="removeRecsManualPick(${index})" title="Убрать">✕</button>
        </div>
    `).join('');
}

function addRecsManualPick(product) {
    if (recsManualPicks.some(p => p.id === product.id)) return;
    recsManualPicks.push(product);
    renderRecsManualPicks();
    markRecsSettingsChanged();
}

function removeRecsManualPick(index) {
    recsManualPicks.splice(index, 1);
    renderRecsManualPicks();
    markRecsSettingsChanged();
}

function initRecsProductSearch() {
    const input = document.getElementById('recsProductSearchInput');
    const dropdown = document.getElementById('recsProductSearchResults');
    if (!input || !dropdown) return;

    input.addEventListener('input', () => {
        clearTimeout(recsSearchDebounceTimer);
        const query = input.value.trim();
        if (query.length < 2) {
            dropdown.style.display = 'none';
            dropdown.innerHTML = '';
            return;
        }
        recsSearchDebounceTimer = setTimeout(() => searchRecsProducts(query), 250);
    });

    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target) && e.target !== input) {
            dropdown.style.display = 'none';
        }
    });
}

async function searchRecsProducts(query) {
    if (!currentProject || !currentProject.api_key) return;
    const dropdown = document.getElementById('recsProductSearchResults');
    if (!dropdown) return;

    try {
        const params = new URLSearchParams({ q: query, api_key: currentProject.api_key, limit: 8 });
        const response = await fetch(`${API_BASE}/api/v1/search?${params}`);
        const data = await response.json();
        const items = data.items || [];

        if (items.length === 0) {
            dropdown.innerHTML = '<div class="recs-search-dropdown-item">Ничего не найдено</div>';
        } else {
            dropdown.innerHTML = items.map(p => `
                <div class="recs-search-dropdown-item" data-id="${escapeHtml(p.id)}">
                    ${p.image ? `<img src="${escapeHtml(p.image)}" alt="">` : ''}
                    <span>${escapeHtml(p.name || p.id)}</span>
                    ${p.price ? `<span class="recs-item-price">${formatPrice(p.price)} ₽</span>` : ''}
                </div>
            `).join('');
            dropdown.querySelectorAll('.recs-search-dropdown-item[data-id]').forEach((el, i) => {
                el.addEventListener('click', () => {
                    addRecsManualPick(items[i]);
                    document.getElementById('recsProductSearchInput').value = '';
                    dropdown.style.display = 'none';
                    dropdown.innerHTML = '';
                });
            });
        }
        dropdown.style.display = 'block';
    } catch (err) {
        console.error('Error searching products for recommendations:', err);
    }
}

// ---- Attribute filter rules ----
async function onRecsFilterFieldChange() {
    const select = document.getElementById('recsFilterFieldSelect');
    const valuesList = document.getElementById('recsFilterValuesList');
    const addBtn = document.getElementById('recsAddFilterRuleBtn');
    const field = select.value;

    if (!field || !currentProject) {
        valuesList.style.display = 'none';
        addBtn.style.display = 'none';
        return;
    }

    valuesList.innerHTML = '<div class="form-hint">Загрузка значений...</div>';
    valuesList.style.display = 'block';

    try {
        const data = await fetchAPI(`/api/v1/projects/${currentProject.id}/field-values?field=${encodeURIComponent(field)}`);
        const values = data.values || [];
        if (values.length === 0) {
            valuesList.innerHTML = '<div class="form-hint">Нет значений для этого поля</div>';
            addBtn.style.display = 'none';
            return;
        }
        valuesList.innerHTML = values.map(v => `
            <label class="checkbox-item">
                <input type="checkbox" name="recsFilterValue" value="${escapeHtml(v.value)}">
                <span>${escapeHtml(v.value)} (${v.count})</span>
            </label>
        `).join('');
        addBtn.style.display = 'inline-flex';
    } catch (err) {
        console.error('Error loading field values:', err);
        valuesList.innerHTML = '<div class="form-hint">Ошибка загрузки значений</div>';
    }
}

function addRecsFilterRule() {
    const fieldSelect = document.getElementById('recsFilterFieldSelect');
    const field = fieldSelect.value;
    if (!field) return;

    const checked = document.querySelectorAll('#recsFilterValuesList input[name="recsFilterValue"]:checked');
    const values = Array.from(checked).map(cb => cb.value);
    if (values.length === 0) {
        showToast('Выберите хотя бы одно значение', 'error');
        return;
    }

    recsFilterRules = recsFilterRules.filter(r => r.field !== field);
    recsFilterRules.push({ field, values });

    fieldSelect.value = '';
    document.getElementById('recsFilterValuesList').style.display = 'none';
    document.getElementById('recsAddFilterRuleBtn').style.display = 'none';

    renderRecsFilterRules();
    markRecsSettingsChanged();
}

function removeRecsFilterRule(index) {
    recsFilterRules.splice(index, 1);
    renderRecsFilterRules();
    markRecsSettingsChanged();
}

function renderRecsFilterRules() {
    const listEl = document.getElementById('recsFilterRulesList');
    if (!listEl) return;
    if (recsFilterRules.length === 0) {
        listEl.innerHTML = '<div class="form-hint">Правила не добавлены</div>';
        return;
    }
    listEl.innerHTML = recsFilterRules.map((rule, index) => `
        <div class="synonym-group" data-index="${index}">
            <div class="synonym-words">
                <span class="synonym-word">${escapeHtml(rule.field)}: ${rule.values.map(v => escapeHtml(v)).join(', ')}</span>
            </div>
            <button class="synonym-delete-btn" onclick="removeRecsFilterRule(${index})" title="Удалить">✕</button>
        </div>
    `).join('');
}

// ---- Save / embed code ----
async function saveRecommendationsSettings() {
    if (!currentProject) return;
    const limitInput = document.getElementById('recsLimit');
    const saveBtn = document.getElementById('saveRecsSettingsBtn');
    const statusEl = document.getElementById('recsSettingsStatus');

    saveBtn.disabled = true;
    statusEl.textContent = 'Сохранение...';

    try {
        const manualProductIds = recsManualPicks.map(p => p.id);
        const attributeFilters = {};
        recsFilterRules.forEach(r => { attributeFilters[r.field] = r.values; });

        let settings = await fetchAPI(`/api/v1/projects/${currentProject.id}/search-settings`);
        if (typeof settings === 'string') {
            try { settings = JSON.parse(settings); } catch (e) { settings = {}; }
        }

        if (manualProductIds.length > 0 || Object.keys(attributeFilters).length > 0) {
            settings.recommendations = {
                limit: parseInt(limitInput.value) || 8,
                manualProductIds,
                attributeFilters
            };
        } else {
            delete settings.recommendations;
        }

        await fetchAPI(`/api/v1/projects/${currentProject.id}/search-settings`, {
            method: 'PUT',
            body: JSON.stringify(settings)
        });

        recsSettingsChanged = false;
        statusEl.textContent = '✓ Сохранено';
        showToast('Настройки рекомендаций сохранены', 'success');
        currentProject.search_settings = settings;

    } catch (err) {
        console.error('Error saving recommendations settings:', err);
        saveBtn.disabled = false;
        statusEl.textContent = 'Ошибка сохранения';
        showToast('Ошибка сохранения настроек', 'error');
    }
}

function updateRecsEmbedCode() {
    if (!currentProject) return;
    const baseUrl = window.location.origin;
    const apiKey = currentProject.api_key || 'ВАШ_API_КЛЮЧ';

    const scriptUrlEl = document.getElementById('recsEmbedScriptUrl');
    const apiKeyEl = document.getElementById('recsEmbedApiKey');
    if (scriptUrlEl) scriptUrlEl.textContent = `${baseUrl}/recommendations.js`;
    if (apiKeyEl) apiKeyEl.textContent = apiKey;
}

// ==================== SYNONYMS ====================
let synonymGroups = [];

async function loadSynonyms() {
    if (!currentProject) return;
    
    const listEl = document.getElementById('synonymsList');
    if (!listEl) return;
    
    listEl.innerHTML = '<div class="form-hint">Загрузка...</div>';
    
    try {
        const data = await fetchAPI(`/api/v1/projects/${currentProject.id}/synonyms`);
        synonymGroups = data.synonyms || [];
        renderSynonyms();
    } catch (err) {
        console.log('No synonyms yet');
        synonymGroups = [];
        renderSynonyms();
    }
}

function renderSynonyms() {
    const listEl = document.getElementById('synonymsList');
    if (!listEl) return;
    
    if (synonymGroups.length === 0) {
        listEl.innerHTML = '<div class="form-hint">Синонимы не добавлены</div>';
        return;
    }
    
    listEl.innerHTML = synonymGroups.map((group, index) => `
        <div class="synonym-group" data-index="${index}">
            <div class="synonym-words">${group.map(w => `<span class="synonym-word">${escapeHtml(w)}</span>`).join('')}</div>
            <button class="synonym-delete-btn" onclick="deleteSynonymGroup(${index})" title="Удалить">✕</button>
        </div>
    `).join('');
}

async function addSynonymGroup() {
    if (!currentProject) return;
    
    const input = document.getElementById('newSynonymInput');
    const statusEl = document.getElementById('synonymsStatus');
    const value = input.value.trim();
    
    if (!value) return;
    
    // Парсим слова (разделитель - запятая)
    const words = value.split(',').map(w => w.trim().toLowerCase()).filter(w => w.length > 0);
    
    if (words.length < 2) {
        showToast('Введите минимум 2 слова через запятую', 'error');
        return;
    }
    
    // Проверяем что такой группы еще нет
    const isDuplicate = synonymGroups.some(group => 
        words.some(w => group.includes(w))
    );
    
    if (isDuplicate) {
        showToast('Одно из слов уже есть в другой группе синонимов', 'error');
        return;
    }
    
    statusEl.textContent = 'Сохранение...';
    
    try {
        synonymGroups.push(words);
        await saveSynonyms();
        
        input.value = '';
        renderSynonyms();
        statusEl.textContent = '✓ Добавлено';
        showToast('Группа синонимов добавлена', 'success');
        
        setTimeout(() => { statusEl.textContent = ''; }, 2000);
    } catch (err) {
        synonymGroups.pop();
        statusEl.textContent = 'Ошибка';
        showToast('Ошибка сохранения синонимов', 'error');
    }
}

async function deleteSynonymGroup(index) {
    if (!currentProject) return;
    
    const statusEl = document.getElementById('synonymsStatus');
    const removed = synonymGroups.splice(index, 1);
    
    statusEl.textContent = 'Удаление...';
    
    try {
        await saveSynonyms();
        renderSynonyms();
        statusEl.textContent = '✓ Удалено';
        showToast('Группа синонимов удалена', 'success');
        
        setTimeout(() => { statusEl.textContent = ''; }, 2000);
    } catch (err) {
        synonymGroups.splice(index, 0, ...removed);
        renderSynonyms();
        statusEl.textContent = 'Ошибка';
        showToast('Ошибка удаления синонимов', 'error');
    }
}

async function saveSynonyms() {
    await fetchAPI(`/api/v1/projects/${currentProject.id}/synonyms`, {
        method: 'PUT',
        body: JSON.stringify({ synonyms: synonymGroups })
    });
}

// ==================== PROJECT STATISTICS ====================
async function loadProjectStatistics() {
    if (!currentProject) return;
    
    // Get selected period
    const periodSelect = document.getElementById('projectStatsPeriod');
    const days = periodSelect ? parseInt(periodSelect.value) : 7;
    
    try {
        const analytics = await fetchAPI(`/api/v1/projects/${currentProject.id}/analytics?days=${days}`);
        
        // Update mini stats
        const searches = analytics.total_queries || 0;
        const clicks = analytics.total_clicks || 0;
        const ctr = searches > 0 ? Math.round((clicks / searches) * 100) : 0;
        const avgTime = analytics.avg_response_time_ms || 0;
        
        document.getElementById('projectAnalyticsSearches').textContent = formatNumber(searches);
        document.getElementById('projectAnalyticsClicks').textContent = formatNumber(clicks);
        document.getElementById('projectAnalyticsCTR').textContent = ctr + '%';
        document.getElementById('projectAnalyticsAvgTime').textContent = Math.round(avgTime) + 'ms';
        
        // Update popular queries list
        const queriesEl = document.getElementById('projectPopularQueries');
        const queries = analytics.popular_queries || [];
        
        if (queries.length === 0) {
            queriesEl.innerHTML = '<div class="loading-sm">Нет данных о запросах</div>';
        } else {
            queriesEl.innerHTML = queries.slice(0, 5).map((q, i) => `
                <div class="compact-list-item">
                    <span class="compact-list-rank ${i < 3 ? 'top' : ''}">${i + 1}</span>
                    <span class="compact-list-text">${escapeHtml(q.query)}</span>
                    <span class="compact-list-count">${q.count}</span>
                </div>
            `).join('');
        }
        
        // Update popular products
        const productsEl = document.getElementById('projectPopularProducts');
        const popularProducts = analytics.popular_products || [];
        
        if (popularProducts.length === 0) {
            productsEl.innerHTML = '<div class="loading-sm">Нет данных о популярных товарах</div>';
        } else {
            // Load product details for popular products
            const productCards = await Promise.all(
                popularProducts.slice(0, 6).map(async (p) => {
                    try {
                        // Try to get product info from products endpoint
                        const product = await getProductById(currentProject.id, p.product_id);
                        if (product) {
                            return `
                                <div class="popular-product-card">
                                    ${product.image ? `<img src="${escapeHtml(product.image)}" class="popular-product-image" alt="" onerror="this.style.display='none'">` : ''}
                                    <div class="popular-product-name">${escapeHtml(product.name || p.product_id)}</div>
                                    <div class="popular-product-clicks">${p.clicks} кликов</div>
                                </div>
                            `;
                        }
                    } catch (e) {}
                    
                    return `
                        <div class="popular-product-card">
                            <div class="popular-product-name">ID: ${escapeHtml(p.product_id)}</div>
                            <div class="popular-product-clicks">${p.clicks} кликов</div>
                        </div>
                    `;
                })
            );
            productsEl.innerHTML = productCards.join('');
        }
        
    } catch (err) {
        console.error('Error loading project statistics:', err);
        document.getElementById('projectAnalyticsSearches').textContent = '0';
        document.getElementById('projectAnalyticsClicks').textContent = '0';
        document.getElementById('projectAnalyticsCTR').textContent = '0%';
        document.getElementById('projectAnalyticsAvgTime').textContent = '0ms';
        document.getElementById('projectPopularQueries').innerHTML = '<div class="loading-sm">Ошибка загрузки</div>';
        document.getElementById('projectPopularProducts').innerHTML = '<div class="loading-sm">Ошибка загрузки</div>';
    }
}

// Format number with thousands separator
function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

async function getProductById(projectId, productId) {
    try {
        // First try to get from cached products
        const products = await fetchAPI(`/api/v1/projects/${projectId}/products?limit=1000`);
        const product = products.find(p => p.id === productId);
        return product || null;
    } catch (e) {
        return null;
    }
}

async function loadProjectFeed() {
    if (!currentProject) return;
    
    if (!currentProject.feed_url) {
        showToast('Сначала укажите URL фида в настройках проекта', 'error');
        editProject(currentProject.id);
        return;
    }
    
    const btn = document.getElementById('projectLoadFeedBtn');
    const btnText = btn.querySelector('.btn-text');
    const btnSpinner = btn.querySelector('.btn-spinner');
    const progressContainer = document.getElementById('feedProgressContainer');
    const statusBadge = document.getElementById('projectFeedStatus');
    const progressFill = document.getElementById('feedProgressFill');
    const progressPercent = document.getElementById('feedProgressPercent');
    const progressText = document.getElementById('feedProgressText');
    
    // Show loading state
    btn.disabled = true;
    btnText.style.display = 'none';
    btnSpinner.style.display = 'inline';
    progressContainer.style.display = 'block';
    statusBadge.className = 'feed-status-badge loading';
    statusBadge.innerHTML = '<span class="status-dot"></span><span>Загрузка...</span>';
    
    // Фиксируем ID проекта на момент запуска - currentProject может
    // измениться, если пользователь переключится на другой проект
    // пока идёт опрос статуса, и тогда опрос начнёт показывать
    // данные чужого проекта в этой же панели
    const projectId = currentProject.id;

    try {
        // Запускаем фоновую загрузку
        await fetchAPI(`/api/v1/projects/${projectId}/feed/load`, {
            method: 'POST'
        });

        // Polling статуса каждые 2 секунды
        const pollStatus = async () => {
            // Пользователь ушёл на другой проект - прекращаем опрос,
            // не трогая чужую панель. Сама загрузка на сервере не прервётся.
            if (currentProject?.id !== projectId) {
                return;
            }
            try {
                const status = await fetchAPI(`/api/v1/projects/${projectId}/feed/status`);

                const progress = parseInt(status.progress) || 0;
                progressFill.style.width = progress + '%';
                progressPercent.textContent = progress + '%';
                progressText.textContent = status.message || 'Загрузка...';
                
                if (status.status === 'downloading') {
                    statusBadge.innerHTML = '<span class="status-dot"></span><span>Загрузка...</span>';
                } else if (status.status === 'indexing') {
                    statusBadge.innerHTML = '<span class="status-dot"></span><span>Индексация...</span>';
                } else if (status.status === 'success') {
                    // Готово!
                    progressFill.style.width = '100%';
                    progressPercent.textContent = '100%';
                    progressText.textContent = status.message || 'Готово!';
                    
                    statusBadge.className = 'feed-status-badge success';
                    statusBadge.innerHTML = '<span class="status-dot"></span><span>Загружен</span>';
                    
                    const productsCount = parseInt(status.products_count) || 0;
                    const categoriesCount = parseInt(status.categories_count) || 0;
                    
                    // Update stats
                    document.getElementById('projectStatProducts').textContent = productsCount;
                    document.getElementById('projectStatCategories').textContent = categoriesCount;
                    
                    setTimeout(() => {
                        progressContainer.style.display = 'none';
                        btn.disabled = false;
                        btnText.style.display = 'inline';
                        btnSpinner.style.display = 'none';
                        showToast(`Загружено ${productsCount} товаров`, 'success');
                        loadProjects();
                    }, 500);
                    return; // Stop polling
                    
                } else if (status.status === 'error') {
                    // Ошибка
                    statusBadge.className = 'feed-status-badge error';
                    statusBadge.innerHTML = '<span class="status-dot"></span><span>Ошибка</span>';
                    progressContainer.style.display = 'none';
                    btn.disabled = false;
                    btnText.style.display = 'inline';
                    btnSpinner.style.display = 'none';
                    showToast(status.message || 'Ошибка загрузки фида', 'error');
                    return; // Stop polling
                }
                
                // Продолжаем polling
                setTimeout(pollStatus, 2000);
                
            } catch (err) {
                console.error('Poll status error:', err);
                setTimeout(pollStatus, 2000);
            }
        };
        
        // Начинаем polling
        setTimeout(pollStatus, 1000);
        
    } catch (err) {
        progressContainer.style.display = 'none';
        statusBadge.className = 'feed-status-badge error';
        statusBadge.innerHTML = '<span class="status-dot"></span><span>Ошибка</span>';
        btn.disabled = false;
        btnText.style.display = 'inline';
        btnSpinner.style.display = 'none';
        showToast(err.message || 'Ошибка загрузки фида', 'error');
    }
}

async function refreshProjectFeed() {
    await loadProjectFeed();
}

function editCurrentProject() {
    if (currentProject) {
        editProject(currentProject.id);
    }
}

function deleteCurrentProject() {
    if (currentProject) {
        deleteProject(currentProject.id);
    }
}

async function toggleApiKeyVisibility() {
    if (!currentProject) return;
    
    const el = document.getElementById('projectApiKey');
    
    if (apiKeyVisible) {
        el.textContent = '••••••••••••••••';
        apiKeyVisible = false;
    } else {
        // Fetch project to get API key
        try {
            const project = await fetchAPI(`/api/v1/projects/${currentProject.id}`);
            el.textContent = project.api_key || 'Не найден';
            apiKeyVisible = true;
        } catch (err) {
            showToast('Ошибка загрузки ключа', 'error');
        }
    }
}

function copyApiKey() {
    if (!currentProject) return;
    
    const el = document.getElementById('projectApiKey');
    const text = el.textContent;
    
    if (text.includes('•')) {
        showToast('Сначала покажите ключ', 'error');
        return;
    }
    
    navigator.clipboard.writeText(text).then(() => {
        showToast('API ключ скопирован', 'success');
    });
}

async function regenerateApiKey() {
    if (!currentProject) return;
    
    if (!confirm('Сгенерировать новый API ключ? Старый ключ перестанет работать.')) {
        return;
    }
    
    try {
        const result = await fetchAPI(`/api/v1/projects/${currentProject.id}/regenerate-key`, {
            method: 'POST'
        });
        document.getElementById('projectApiKey').textContent = result.api_key;
        apiKeyVisible = true;
        showToast('Новый ключ сгенерирован', 'success');
    } catch (err) {
        showToast(err.message || 'Ошибка генерации ключа', 'error');
    }
}

function goToProducts() {
    if (currentProject) {
        document.getElementById('productsProjectSelect').value = currentProject.id;
        showSection('products');
        onProjectSelectChange();
    }
}

function goToAnalytics() {
    if (currentProject) {
        document.getElementById('analyticsProjectSelect').value = currentProject.id;
        showSection('analytics');
        loadAnalytics();
    }
}

function goToWidget() {
    if (currentProject) {
        document.getElementById('widgetProjectSelect').value = currentProject.id;
        showSection('widget');
    }
}

function goToEmbed() {
    if (currentProject) {
        document.getElementById('embedProjectSelect').value = currentProject.id;
        showSection('embed');
        updateEmbedCode();
    }
}

// ==================== DASHBOARD STATS ====================
async function loadDashboardStats() {
    // Calculate stats from projects
    let totalProducts = 0;
    let totalSearches = 0;
    let totalClicks = 0;
    
    const projectsList = Array.isArray(projects) ? projects : [];
    projectsList.forEach(p => {
        totalProducts += p.products_count || 0;
        totalSearches += p.searches_count || 0;
    });
    
    const ctr = totalSearches > 0 ? Math.round((totalClicks / totalSearches) * 100) : 0;
    
    animateNumber('statProjects', projectsList.length);
    animateNumber('statProducts', totalProducts);
    animateNumber('statSearches', totalSearches);
    document.getElementById('statCTR').textContent = ctr + '%';
    
    // Load top queries
    loadTopQueries();
}

async function loadTopQueries() {
    const container = document.getElementById('topQueriesList');
    
    try {
        // Try to get analytics from first project
        if (projects.length > 0) {
            const analytics = await fetchAPI(`/api/v1/projects/${projects[0].id}/analytics`);
            const queries = analytics.popular_queries || [];
            
            if (queries.length === 0) {
                container.innerHTML = `
                    <div style="padding: 40px; text-align: center; color: var(--gray-500);">
                        Пока нет данных
                    </div>
                `;
                return;
            }
            
            container.innerHTML = queries.slice(0, 5).map((q, i) => `
                <div class="query-item">
                    <span class="query-rank ${i < 3 ? 'top' : ''}">${i + 1}</span>
                    <span class="query-text">${escapeHtml(q.query)}</span>
                    <span class="query-count">${q.count}</span>
                </div>
            `).join('');
        } else {
            container.innerHTML = `
                <div style="padding: 40px; text-align: center; color: var(--gray-500);">
                    Создайте проект для начала
                </div>
            `;
        }
    } catch (err) {
        container.innerHTML = `
            <div style="padding: 40px; text-align: center; color: var(--gray-500);">
                Нет данных
            </div>
        `;
    }
}

// ==================== CHARTS ====================
function initCharts() {
    // Search Chart
    const searchCtx = document.getElementById('searchChart');
    if (searchCtx) {
        searchChart = new Chart(searchCtx, {
            type: 'line',
            data: {
                labels: getLast7Days(),
                datasets: [{
                    label: 'Поисков',
                    data: [0, 0, 0, 0, 0, 0, 0],
                    borderColor: '#4F46E5',
                    backgroundColor: 'rgba(79, 70, 229, 0.1)',
                    fill: true,
                    tension: 0.4,
                    borderWidth: 2,
                    pointBackgroundColor: '#4F46E5',
                    pointRadius: 4,
                    pointHoverRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(0,0,0,0.05)' }
                    },
                    x: {
                        grid: { display: false }
                    }
                }
            }
        });
    }
    
    // Analytics Chart
    const analyticsCtx = document.getElementById('analyticsChart');
    if (analyticsCtx) {
        analyticsChart = new Chart(analyticsCtx, {
            type: 'bar',
            data: {
                labels: getLast7Days(),
                datasets: [{
                    label: 'Поисков',
                    data: [0, 0, 0, 0, 0, 0, 0],
                    backgroundColor: 'rgba(79, 70, 229, 0.8)',
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(0,0,0,0.05)' }
                    },
                    x: {
                        grid: { display: false }
                    }
                }
            }
        });
    }
}

function getLast7Days() {
    const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    const result = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        result.push(days[d.getDay()]);
    }
    return result;
}

// ==================== PRODUCTS ====================
function onProjectSelectChange() {
    const projectId = document.getElementById('productsProjectSelect').value;
    
    if (!projectId) {
        document.getElementById('feedPanel').style.display = 'none';
        document.getElementById('productsTable').style.display = 'none';
        document.getElementById('noProjectSelected').style.display = 'block';
        return;
    }
    
    currentProject = projects.find(p => p.id === projectId);
    document.getElementById('noProjectSelected').style.display = 'none';
    document.getElementById('feedPanel').style.display = 'block';
    
    loadProjectProducts(projectId);
}

async function loadProjectProducts(projectId) {
    try {
        const project = projects.find(p => p.id === projectId);
        
        // Update feed URL if exists
        if (project?.feed_url) {
            document.getElementById('feedUrlInput').value = project.feed_url;
            document.getElementById('refreshFeedBtn').style.display = 'block';
            updateFeedStatus('success', 'Фид загружен');
        } else {
            document.getElementById('feedUrlInput').value = '';
            document.getElementById('refreshFeedBtn').style.display = 'none';
            updateFeedStatus('neutral', 'Фид не загружен');
        }
        
        // Load products. limit=500 - максимум, который отдаёт бэкенд за раз (le=500);
        // используем response.total (точный SCARD, не зависит от limit) для счётчиков,
        // а не products.length - иначе каталог из 200+ товаров всегда показывал бы
        // ровно дефолтный лимит вместо реального количества
        const response = await fetchAPI(`/api/v1/projects/${projectId}/products?limit=${PRODUCTS_FETCH_LIMIT}`);
        products = response.products || response || [];
        productsTotal = typeof response.total === 'number' ? response.total : products.length;
        productsPage = 1;

        if (products.length > 0) {
            document.getElementById('productsTable').style.display = 'block';
            document.getElementById('feedStats').style.display = 'grid';

            // Категории/наличие считаются по загруженной пачке (до 500 товаров) - для
            // каталогов больше 500 это будет приближением, не точным значением по всему фиду
            const categories = new Set(products.map(p => p.category || p.category_name).filter(Boolean));
            const inStock = products.filter(p => {
                if (p.available !== undefined) return p.available;
                if (p.in_stock !== undefined) return p.in_stock;
                return true;
            }).length;

            document.getElementById('feedTotalProducts').textContent = productsTotal;
            document.getElementById('feedCategories').textContent = categories.size;
            document.getElementById('feedInStock').textContent = inStock;
            document.getElementById('feedLastUpdate').textContent = 'Сегодня';

            renderProducts();
        } else {
            document.getElementById('productsTable').style.display = 'none';
            document.getElementById('feedStats').style.display = 'none';
        }
        
    } catch (err) {
        console.error('Error loading products:', err);
        showToast('Ошибка загрузки товаров', 'error');
    }
}

function renderProducts() {
    const container = document.getElementById('productsBody');
    const start = (productsPage - 1) * productsPerPage;
    const end = start + productsPerPage;
    const pageProducts = products.slice(start, end);
    
    container.innerHTML = pageProducts.map(p => {
        // Поддержка разных форматов полей
        const image = p.picture || p.image || (p.images && p.images[0]) || '';
        const name = p.name || p.title || 'Без названия';
        const category = p.category || p.category_name || '';
        const inStock = p.available !== undefined ? p.available : (p.in_stock !== undefined ? p.in_stock : true);
        
        return `
            <tr>
                <td>
                    <div class="product-cell">
                        ${image ? 
                            `<img src="${escapeHtml(image)}" class="product-image" alt="" onerror="this.style.display='none'">` :
                            `<div class="product-image-placeholder">📦</div>`
                        }
                        <span class="product-name">${escapeHtml(name)}</span>
                    </div>
                </td>
                <td class="product-category">${escapeHtml(category || '—')}</td>
                <td class="product-price">${formatPrice(p.price)} ₽</td>
                <td>
                    <span class="badge ${inStock ? 'badge-success' : 'badge-danger'}">
                        ${inStock ? 'В наличии' : 'Нет'}
                    </span>
                </td>
            </tr>
        `;
    }).join('');
    
    // Update count. Если загруженная пачка (до PRODUCTS_FETCH_LIMIT) меньше реального
    // total - каталог больше лимита за один запрос, показываем это явно, а не молча
    // выдаём кол-во загруженного за общее число товаров
    const countLabel = products.length < productsTotal
        ? `${productsTotal} товаров (показано ${products.length})`
        : `${productsTotal} товаров`;
    document.getElementById('productsCount').textContent = countLabel;
    
    // Render pagination
    renderPagination();
}

function renderPagination() {
    const totalPages = Math.ceil(products.length / productsPerPage);
    const container = document.getElementById('productsPagination');
    
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }
    
    let html = `
        <button class="page-btn" onclick="changePage(${productsPage - 1})" ${productsPage === 1 ? 'disabled' : ''}>‹</button>
    `;
    
    for (let i = 1; i <= Math.min(totalPages, 5); i++) {
        html += `
            <button class="page-btn ${i === productsPage ? 'active' : ''}" onclick="changePage(${i})">${i}</button>
        `;
    }
    
    if (totalPages > 5) {
        html += `<span class="pagination-info">...</span>`;
        html += `<button class="page-btn" onclick="changePage(${totalPages})">${totalPages}</button>`;
    }
    
    html += `
        <button class="page-btn" onclick="changePage(${productsPage + 1})" ${productsPage === totalPages ? 'disabled' : ''}>›</button>
    `;
    
    container.innerHTML = html;
}

function changePage(page) {
    const totalPages = Math.ceil(products.length / productsPerPage);
    if (page < 1 || page > totalPages) return;
    productsPage = page;
    renderProducts();
}

function filterProducts() {
    const query = document.getElementById('productsSearch').value.toLowerCase();
    // Simple filter - in real app would re-render
    const rows = document.querySelectorAll('#productsBody tr');
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(query) ? '' : 'none';
    });
}

// ==================== FEED ====================
async function loadFeed() {
    const url = document.getElementById('feedUrlInput').value.trim();
    const projectId = document.getElementById('productsProjectSelect').value;
    
    if (!url) {
        showToast('Введите URL фида', 'error');
        return;
    }
    
    if (!projectId) {
        showToast('Выберите проект', 'error');
        return;
    }
    
    const btn = document.getElementById('loadFeedBtn');
    btn.disabled = true;
    btn.textContent = 'Загрузка...';
    updateFeedStatus('warning', 'Загрузка...');
    
    try {
        // Запускаем фоновую загрузку
        await fetchAPI(`/api/v1/projects/${projectId}/feed/load`, {
            method: 'POST',
            body: JSON.stringify({ url })
        });
        
        // Polling статуса
        const pollStatus = async () => {
            // Пользователь выбрал другой проект в списке - прекращаем опрос,
            // не трогая чужой статус. Сама загрузка на сервере не прервётся.
            if (document.getElementById('productsProjectSelect').value !== projectId) {
                return;
            }
            try {
                const status = await fetchAPI(`/api/v1/projects/${projectId}/feed/status`);

                if (status.status === 'downloading') {
                    updateFeedStatus('warning', 'Загрузка фида...');
                } else if (status.status === 'indexing') {
                    updateFeedStatus('warning', 'Индексация...');
                } else if (status.status === 'success') {
                    updateFeedStatus('success', status.message || 'Готово!');
                    btn.disabled = false;
                    btn.textContent = 'Загрузить';
                    document.getElementById('refreshFeedBtn').style.display = 'block';
                    showToast(`Загружено ${status.products_count || 0} товаров`, 'success');
                    await loadProjects();
                    await loadProjectProducts(projectId);
                    return; // Stop polling
                } else if (status.status === 'error') {
                    updateFeedStatus('error', status.message || 'Ошибка');
                    btn.disabled = false;
                    btn.textContent = 'Загрузить';
                    showToast(status.message || 'Ошибка загрузки', 'error');
                    return; // Stop polling
                }
                
                // Continue polling
                setTimeout(pollStatus, 2000);
            } catch (err) {
                setTimeout(pollStatus, 2000);
            }
        };
        
        setTimeout(pollStatus, 1000);
        
    } catch (err) {
        showToast(err.message || 'Ошибка загрузки фида', 'error');
        updateFeedStatus('error', 'Ошибка загрузки');
        btn.disabled = false;
        btn.textContent = 'Загрузить';
    }
}

async function refreshFeed() {
    const projectId = document.getElementById('productsProjectSelect').value;
    if (!projectId) return;
    
    const project = projects.find(p => p.id === projectId);
    if (!project?.feed_url) {
        showToast('URL фида не указан', 'error');
        return;
    }
    
    document.getElementById('feedUrlInput').value = project.feed_url;
    await loadFeed();
}

function updateFeedStatus(status, text) {
    const container = document.getElementById('feedStatus');
    container.innerHTML = `
        <span class="status-dot ${status}"></span>
        <span>${text}</span>
    `;
}

// ==================== ANALYTICS ====================
async function loadAnalytics() {
    const projectId = document.getElementById('analyticsProjectSelect').value;
    
    try {
        let analytics;
        
        if (projectId) {
            analytics = await fetchAPI(`/api/v1/projects/${projectId}/analytics`);
        } else if (projects.length > 0) {
            // Aggregate all projects
            analytics = { total_searches: 0, total_clicks: 0, popular_queries: [] };
            for (const p of projects) {
                try {
                    const a = await fetchAPI(`/api/v1/projects/${p.id}/analytics`);
                    analytics.total_searches += a.total_searches || 0;
                    analytics.total_clicks += a.total_clicks || 0;
                } catch (e) {}
            }
        } else {
            analytics = { total_searches: 0, total_clicks: 0, popular_queries: [] };
        }
        
        // Update stats
        const searches = analytics.total_searches || 0;
        const clicks = analytics.total_clicks || 0;
        const ctr = searches > 0 ? Math.round((clicks / searches) * 100) : 0;
        
        animateNumber('analyticsSearches', searches);
        animateNumber('analyticsClicks', clicks);
        document.getElementById('analyticsCTR').textContent = ctr + '%';
        document.getElementById('analyticsAvgTime').textContent = (analytics.avg_time || 45) + 'ms';
        
        // Update donut
        const donut = document.getElementById('conversionDonut');
        const circumference = 2 * Math.PI * 40;
        const offset = circumference * (1 - ctr / 100);
        donut.style.strokeDasharray = `${circumference - offset} ${offset}`;
        document.getElementById('conversionValue').textContent = ctr + '%';
        document.getElementById('legendClicks').textContent = clicks;
        document.getElementById('legendNoClicks').textContent = Math.max(0, searches - clicks);
        
        // Update queries list
        const queries = analytics.popular_queries || [];
        const container = document.getElementById('analyticsQueriesList');
        
        if (queries.length === 0) {
            container.innerHTML = `
                <div style="padding: 40px; text-align: center; color: var(--gray-500);">
                    Пока нет данных о запросах
                </div>
            `;
        } else {
            container.innerHTML = queries.slice(0, 10).map((q, i) => `
                <div class="query-item">
                    <span class="query-rank ${i < 3 ? 'top' : ''}">${i + 1}</span>
                    <span class="query-text">${escapeHtml(q.query)}</span>
                    <span class="query-count">${q.count}</span>
                </div>
            `).join('');
        }
        
    } catch (err) {
        console.error('Error loading analytics:', err);
    }
}

// ==================== WIDGET SETTINGS ====================
function loadWidgetSettings() {
    const projectId = document.getElementById('widgetProjectSelect').value;
    document.getElementById('saveWidgetBtn').disabled = !projectId;
    
    if (!projectId) return;
    
    // Load saved settings or use defaults
    const project = projects.find(p => p.id === projectId);
    let settings = project?.widget_settings || {};
    
    // Если настройки пришли как строка JSON - парсим
    if (typeof settings === 'string') {
        try {
            settings = JSON.parse(settings);
        } catch (e) {
            settings = {};
        }
    }
    
    document.getElementById('widgetPrimaryColor').value = settings.primaryColor || '#4F46E5';
    document.getElementById('widgetPrimaryColorText').value = settings.primaryColor || '#4F46E5';
    document.getElementById('widgetTextColor').value = settings.textColor || '#1F2937';
    document.getElementById('widgetTextColorText').value = settings.textColor || '#1F2937';
    document.getElementById('widgetBgColor').value = settings.bgColor || '#FFFFFF';
    document.getElementById('widgetBgColorText').value = settings.bgColor || '#FFFFFF';
    document.getElementById('widgetBorderColor').value = settings.borderColor || '#E5E7EB';
    document.getElementById('widgetBorderColorText').value = settings.borderColor || '#E5E7EB';
    document.getElementById('widgetBorderRadius').value = settings.borderRadius || 10;
    document.getElementById('widgetFontSize').value = settings.fontSize || 15;
    document.getElementById('widgetPlaceholder').value = settings.placeholder || 'Поиск товаров...';
    document.getElementById('widgetShowButton').checked = settings.showButton !== false;
    document.getElementById('widgetShowImages').checked = settings.showImages !== false;
    document.getElementById('widgetShowCartButton').checked = settings.showCartButton !== false;

    updateWidgetPreview();
}

function updateWidgetPreview() {
    const primaryColor = document.getElementById('widgetPrimaryColor').value;
    const textColor = document.getElementById('widgetTextColor').value;
    const bgColor = document.getElementById('widgetBgColor').value;
    const borderColor = document.getElementById('widgetBorderColor').value;
    const borderRadius = document.getElementById('widgetBorderRadius').value;
    const fontSize = document.getElementById('widgetFontSize').value;
    const placeholder = document.getElementById('widgetPlaceholder').value;
    const showButton = document.getElementById('widgetShowButton').checked;
    const showImages = document.getElementById('widgetShowImages').checked;
    
    // Update range values
    document.getElementById('borderRadiusValue').textContent = borderRadius + 'px';
    document.getElementById('fontSizeValue').textContent = fontSize + 'px';
    
    // Update preview
    const preview = document.getElementById('widgetPreview');
    preview.style.backgroundColor = bgColor;
    preview.style.borderRadius = borderRadius + 'px';
    preview.style.color = textColor;
    
    const input = document.getElementById('previewInput');
    input.placeholder = placeholder;
    input.style.fontSize = fontSize + 'px';
    input.style.borderColor = borderColor;
    input.style.borderRadius = (borderRadius * 0.8) + 'px';
    input.style.color = textColor;
    
    const button = document.getElementById('previewButton');
    button.style.backgroundColor = primaryColor;
    button.style.borderRadius = (borderRadius * 0.8) + 'px';
    button.style.display = showButton ? 'block' : 'none';
    
    document.querySelectorAll('.preview-result-img').forEach(img => {
        img.style.display = showImages ? 'block' : 'none';
    });
    
    document.querySelectorAll('.preview-result-price').forEach(price => {
        price.style.color = primaryColor;
    });
}

function syncColorInput(inputId) {
    const textInput = document.getElementById(inputId + 'Text');
    const colorInput = document.getElementById(inputId);
    colorInput.value = textInput.value;
    updateWidgetPreview();
}

async function saveWidgetSettings() {
    const projectId = document.getElementById('widgetProjectSelect').value;
    if (!projectId) return;

    // cartCallbackUrl настраивается на странице проекта (saveCartSettings), не здесь.
    // PUT /widget делает полную замену, поэтому сохраняем текущее значение как есть,
    // иначе сохранение внешнего вида отсюда стёрло бы уже настроенный колбэк корзины
    const project = projects.find(p => p.id === projectId);
    let existingSettings = project?.widget_settings || {};
    if (typeof existingSettings === 'string') {
        try { existingSettings = JSON.parse(existingSettings); } catch (e) { existingSettings = {}; }
    }

    const settings = {
        primaryColor: document.getElementById('widgetPrimaryColor').value,
        textColor: document.getElementById('widgetTextColor').value,
        bgColor: document.getElementById('widgetBgColor').value,
        borderColor: document.getElementById('widgetBorderColor').value,
        borderRadius: parseInt(document.getElementById('widgetBorderRadius').value),
        fontSize: parseInt(document.getElementById('widgetFontSize').value),
        placeholder: document.getElementById('widgetPlaceholder').value,
        cartCallbackUrl: existingSettings.cartCallbackUrl || '',
        showButton: document.getElementById('widgetShowButton').checked,
        showImages: document.getElementById('widgetShowImages').checked,
        showCartButton: document.getElementById('widgetShowCartButton').checked
    };

    try {
        await fetchAPI(`/api/v1/projects/${projectId}/widget`, {
            method: 'PUT',
            body: JSON.stringify(settings)
        });
        
        showToast('Настройки сохранены', 'success');

        // Update local cache
        if (project) {
            project.widget_settings = settings;
        }

    } catch (err) {
        showToast('Ошибка сохранения настроек', 'error');
    }
}

// ==================== EMBED ====================
function updateEmbedCode() {
    const projectId = document.getElementById('embedProjectSelect').value;
    const project = projects.find(p => p.id === projectId);
    const apiKey = project?.api_key || 'ВАШ_API_КЛЮЧ';
    
    const baseUrl = window.location.origin;
    
    document.getElementById('projectApiKey').textContent = project ? apiKey : 'Выберите проект';
    document.getElementById('embedScriptUrl').textContent = `${baseUrl}/embed.js`;
    document.getElementById('embedScriptUrl2').textContent = `${baseUrl}/embed.js`;
    document.getElementById('embedApiKey').textContent = apiKey;
    document.getElementById('embedApiKey2').textContent = apiKey;
}

function copyApiKey() {
    const apiKey = document.getElementById('projectApiKey').textContent;
    if (apiKey === 'Выберите проект') {
        showToast('Сначала выберите проект', 'error');
        return;
    }
    copyToClipboard(apiKey);
    showToast('API ключ скопирован', 'success');
}

function copyCode(elementId) {
    const element = document.getElementById(elementId);
    const code = element.textContent;
    copyToClipboard(code);
    showToast('Код скопирован', 'success');
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).catch(() => {
        // Fallback
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
    });
}

// ==================== TEST SEARCH ====================
async function testSearch() {
    const query = document.getElementById('testSearchInput').value.trim();
    const projectId = document.getElementById('embedProjectSelect').value;
    
    if (!query) {
        showToast('Введите поисковый запрос', 'error');
        return;
    }
    
    if (!projectId) {
        showToast('Выберите проект', 'error');
        return;
    }
    
    const container = document.getElementById('testResults');
    container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    
    try {
        const project = projects.find(p => p.id === projectId);
        const response = await fetch(`${API_BASE}/api/v1/search?api_key=${project.api_key}&q=${encodeURIComponent(query)}`);
        const data = await response.json();
        
        const results = data.results || [];
        
        if (results.length === 0) {
            container.innerHTML = `
                <div class="empty-state" style="border: none; background: transparent;">
                    <div class="empty-icon">😕</div>
                    <p class="empty-text">Ничего не найдено</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = results.slice(0, 10).map(p => `
            <div class="test-result-item">
                ${p.picture ? 
                    `<img src="${escapeHtml(p.picture)}" class="test-result-img" alt="" onerror="this.style.display='none'">` :
                    `<div class="test-result-img" style="display: flex; align-items: center; justify-content: center; color: var(--gray-400);">📦</div>`
                }
                <div class="test-result-info">
                    <div class="test-result-title">${escapeHtml(p.name || p.title)}</div>
                    <div class="test-result-price">${formatPrice(p.price)} ₽</div>
                    <div class="test-result-category">${escapeHtml(p.category || '')}</div>
                </div>
            </div>
        `).join('');
        
    } catch (err) {
        container.innerHTML = `
            <div class="empty-state" style="border: none; background: transparent;">
                <div class="empty-icon">⚠️</div>
                <p class="empty-text">Ошибка поиска</p>
            </div>
        `;
    }
}

// ==================== ADMIN ====================
let adminProjectsCache = [];

async function loadAdminProjects() {
    const tbody = document.getElementById('adminProjectsBody');
    if (!tbody) return;
    try {
        const data = await fetchAPI('/api/v1/admin/projects');
        adminProjectsCache = data.projects || [];
        renderAdminProjectsList(adminProjectsCache);
    } catch (err) {
        console.error('Error loading admin projects:', err);
        tbody.innerHTML = '<tr><td colspan="7">Ошибка загрузки</td></tr>';
    }
}

function renderAdminProjectsList(projectsList) {
    const tbody = document.getElementById('adminProjectsBody');
    if (!tbody) return;

    if (projectsList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7">Проектов пока нет</td></tr>';
        return;
    }

    tbody.innerHTML = projectsList.map(p => {
        const isSuspended = p.status === 'suspended';
        const paidUntilValue = p.paid_until ? p.paid_until : '';
        return `
            <tr>
                <td>
                    <div class="product-name">${escapeHtml(p.name || p.id)}</div>
                    <div class="form-hint">${escapeHtml(p.domain || '')}</div>
                </td>
                <td>${escapeHtml(p.owner_email || '—')}</td>
                <td>
                    <select class="form-select" id="adminStatus_${p.id}" style="width: auto;">
                        <option value="active" ${!isSuspended ? 'selected' : ''}>Активен</option>
                        <option value="suspended" ${isSuspended ? 'selected' : ''}>Приостановлен</option>
                    </select>
                </td>
                <td>
                    <input type="date" class="form-input" id="adminPaidUntil_${p.id}" value="${paidUntilValue}" style="width: auto;">
                </td>
                <td>
                    <input type="text" class="form-input" id="adminPayerCompany_${p.id}" value="${escapeHtml(p.payer_company_name || '')}" placeholder="ООО «Клиент»" style="width: auto;">
                </td>
                <td>
                    <input type="text" class="form-input" id="adminPayerInn_${p.id}" value="${escapeHtml(p.payer_inn || '')}" placeholder="ИНН" style="width: 110px;">
                </td>
                <td style="white-space: nowrap;">
                    <button class="btn btn-secondary btn-sm" onclick="saveProjectBilling('${p.id}')">Сохранить</button>
                    <button class="btn btn-primary btn-sm" onclick="openInvoiceModal('${p.id}')">Выставить счёт</button>
                </td>
            </tr>
        `;
    }).join('');
}

async function saveProjectBilling(projectId) {
    const statusEl = document.getElementById(`adminStatus_${projectId}`);
    const paidUntilEl = document.getElementById(`adminPaidUntil_${projectId}`);
    const payerCompanyEl = document.getElementById(`adminPayerCompany_${projectId}`);
    const payerInnEl = document.getElementById(`adminPayerInn_${projectId}`);
    if (!statusEl || !paidUntilEl) return;

    try {
        await fetchAPI(`/api/v1/admin/projects/${projectId}/billing`, {
            method: 'PUT',
            body: JSON.stringify({
                status: statusEl.value,
                paid_until: paidUntilEl.value || null,
                payer_company_name: payerCompanyEl ? (payerCompanyEl.value || null) : null,
                payer_inn: payerInnEl ? (payerInnEl.value || null) : null
            })
        });
        showToast('Биллинг проекта обновлён', 'success');
    } catch (err) {
        console.error('Error saving project billing:', err);
        showToast('Ошибка сохранения биллинга', 'error');
    }
}

// ---- Payment requisites ----
const REQUISITES_FIELD_IDS = {
    company_name: 'reqCompanyName',
    inn: 'reqInn',
    kpp: 'reqKpp',
    legal_address: 'reqLegalAddress',
    checking_account: 'reqCheckingAccount',
    bank_name: 'reqBankName',
    bik: 'reqBik',
    correspondent_account: 'reqCorrespondentAccount'
};

async function loadPaymentRequisites() {
    try {
        const data = await fetchAPI('/api/v1/admin/payment-requisites');
        for (const [field, elementId] of Object.entries(REQUISITES_FIELD_IDS)) {
            const el = document.getElementById(elementId);
            if (el) el.value = data[field] || '';
        }
    } catch (err) {
        console.error('Error loading payment requisites:', err);
    }
}

async function savePaymentRequisites() {
    const statusEl = document.getElementById('reqSaveStatus');
    const payload = {};
    for (const [field, elementId] of Object.entries(REQUISITES_FIELD_IDS)) {
        const el = document.getElementById(elementId);
        payload[field] = el ? (el.value || null) : null;
    }

    try {
        await fetchAPI('/api/v1/admin/payment-requisites', {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
        if (statusEl) statusEl.textContent = '✓ Сохранено';
        showToast('Реквизиты сохранены', 'success');
    } catch (err) {
        console.error('Error saving payment requisites:', err);
        showToast('Ошибка сохранения реквизитов', 'error');
    }
}

// ---- Invoice generation ----
let invoiceModalProjectId = null;

function openInvoiceModal(projectId) {
    const project = adminProjectsCache.find(p => p.id === projectId);
    invoiceModalProjectId = projectId;
    document.getElementById('invoiceModalProjectName').textContent = project
        ? `Проект: ${project.name} (${project.owner_email || ''})`
        : '';
    document.getElementById('invoiceAmount').value = '';
    document.getElementById('invoiceModal').classList.add('active');
}

function closeInvoiceModal() {
    document.getElementById('invoiceModal').classList.remove('active');
    invoiceModalProjectId = null;
}

async function generateInvoice() {
    if (!invoiceModalProjectId) return;
    const amountEl = document.getElementById('invoiceAmount');
    const amount = parseFloat(amountEl.value);
    if (!amount || amount <= 0) {
        showToast('Введите сумму счёта', 'error');
        return;
    }

    const btn = document.getElementById('invoiceGenerateBtn');
    btn.disabled = true;
    btn.textContent = 'Формирование...';

    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/api/v1/admin/projects/${invoiceModalProjectId}/invoice`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ amount })
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.detail || 'Не удалось сформировать счёт');
        }

        // PDF приходит бинарём, не JSON - скачиваем как файл через blob-ссылку
        const blob = await response.blob();
        const disposition = response.headers.get('Content-Disposition') || '';
        const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
        const filename = filenameMatch ? filenameMatch[1] : 'invoice.pdf';

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);

        showToast('Счёт сформирован', 'success');
        closeInvoiceModal();
    } catch (err) {
        console.error('Error generating invoice:', err);
        showToast(err.message || 'Ошибка формирования счёта', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Сформировать PDF';
    }
}

async function loadAdminUsers() {
    const tbody = document.getElementById('adminUsersBody');
    if (!tbody) return;
    try {
        const data = await fetchAPI('/api/v1/admin/users');
        renderAdminUsersList(data.users || []);
    } catch (err) {
        console.error('Error loading admin users:', err);
        tbody.innerHTML = '<tr><td colspan="5">Ошибка загрузки</td></tr>';
    }
}

const ROLE_LABELS = { admin: 'Admin', manager: 'Менеджер', user: 'Пользователь' };
const ROLE_BADGE_CLASS = { admin: 'badge-info', manager: 'badge-warning', user: 'badge-neutral' };

function renderAdminUsersList(usersList) {
    const tbody = document.getElementById('adminUsersBody');
    if (!tbody) return;

    if (usersList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5">Пользователей пока нет</td></tr>';
        return;
    }

    const isAdmin = currentUser && currentUser.role === 'admin';

    tbody.innerHTML = usersList.map(u => {
        const roleLabel = ROLE_LABELS[u.role] || u.role;
        const badgeClass = ROLE_BADGE_CLASS[u.role] || 'badge-neutral';
        const registered = u.created_at ? new Date(u.created_at).toLocaleDateString('ru-RU') : '—';

        let actionHtml = '—';
        if (isAdmin && u.role !== 'admin') {
            actionHtml = u.role === 'manager'
                ? `<button class="btn btn-secondary btn-sm" onclick="updateUserRole('${u.id}', 'user')">Снять права</button>`
                : `<button class="btn btn-secondary btn-sm" onclick="updateUserRole('${u.id}', 'manager')">Назначить менеджером</button>`;
        }

        return `
            <tr>
                <td>${escapeHtml(u.email)}</td>
                <td>${escapeHtml(u.name || '—')}</td>
                <td><span class="badge ${badgeClass}">${escapeHtml(roleLabel)}</span></td>
                <td>${registered}</td>
                <td>${actionHtml}</td>
            </tr>
        `;
    }).join('');
}

async function updateUserRole(userId, role) {
    try {
        await fetchAPI(`/api/v1/admin/users/${userId}/role`, {
            method: 'PUT',
            body: JSON.stringify({ role })
        });
        showToast('Роль обновлена', 'success');
        loadAdminUsers();
    } catch (err) {
        console.error('Error updating user role:', err);
        showToast('Ошибка изменения роли', 'error');
    }
}

// ==================== NOTIFICATIONS ====================
async function loadNotifications() {
    try {
        const data = await fetchAPI('/api/v1/notifications');
        updateNotifBadge(data.unread_count || 0);
        renderNotifDropdown(data.notifications || []);
    } catch (err) {
        console.error('Error loading notifications:', err);
    }
}

function updateNotifBadge(count) {
    const badge = document.getElementById('notifCount');
    if (!badge) return;
    badge.textContent = count;
    badge.style.display = count > 0 ? 'flex' : 'none';
}

function renderNotifDropdown(notifications) {
    const list = document.getElementById('notifDropdownList');
    if (!list) return;

    if (notifications.length === 0) {
        list.innerHTML = '<div class="notif-empty">Пока пусто</div>';
        return;
    }

    list.innerHTML = notifications.map(n => `
        <div class="notif-item ${n.is_read ? '' : 'unread'}" onclick="markNotificationRead(${n.id})">
            <div class="notif-item-dot"></div>
            <div class="notif-item-body">
                <div class="notif-item-title">${escapeHtml(n.title)}</div>
                <div class="notif-item-time">${new Date(n.created_at).toLocaleString('ru-RU')}</div>
            </div>
        </div>
    `).join('');
}

function toggleNotifDropdown() {
    const dropdown = document.getElementById('notifDropdown');
    if (!dropdown) return;
    dropdown.style.display = dropdown.style.display === 'none' ? 'flex' : 'none';
}

async function markNotificationRead(notificationId) {
    try {
        await fetchAPI(`/api/v1/notifications/${notificationId}/read`, { method: 'POST' });
        loadNotifications();
    } catch (err) {
        console.error('Error marking notification read:', err);
    }
}

async function markAllNotificationsRead() {
    try {
        await fetchAPI('/api/v1/notifications/read-all', { method: 'POST' });
        loadNotifications();
    } catch (err) {
        console.error('Error marking all notifications read:', err);
    }
}

// ==================== LOGOUT ====================
function logout() {
    localStorage.removeItem('token');
    window.location.href = '/auth.html';
}

// ==================== UTILITIES ====================
async function fetchAPI(url, options = {}) {
    const token = localStorage.getItem('token');
    
    const response = await fetch(`${API_BASE}${url}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            ...options.headers
        }
    });
    
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || 'Request failed');
    }
    
    return response.json();
}

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    const icon = document.getElementById('toastIcon');
    const msg = document.getElementById('toastMessage');
    
    toast.className = `toast ${type}`;
    icon.textContent = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
    msg.textContent = message;
    
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatPrice(price) {
    if (!price) return '0';
    return new Intl.NumberFormat('ru-RU').format(price);
}

function animateNumber(elementId, target) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    const start = parseInt(element.textContent) || 0;
    const duration = 500;
    const startTime = performance.now();
    
    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        const current = Math.floor(start + (target - start) * easeOutQuad(progress));
        element.textContent = current.toLocaleString('ru-RU');
        
        if (progress < 1) {
            requestAnimationFrame(update);
        }
    }
    
    requestAnimationFrame(update);
}

function easeOutQuad(t) {
    return t * (2 - t);
}

function toggleUserMenu() {
    // Could show dropdown with settings, profile, etc.
    console.log('Toggle user menu');
}

// ==================== FEED GUIDE ====================
function showFeedGuide() {
    document.getElementById('feedGuideModal').classList.add('active');
}

function closeFeedGuide() {
    document.getElementById('feedGuideModal').classList.remove('active');
}

function copyFeedExample() {
    const code = document.getElementById('feedExampleCode').textContent;
    navigator.clipboard.writeText(code).then(() => {
        showToast('Пример скопирован', 'success');
    });
}
