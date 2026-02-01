/**
 * SearchPro Dashboard - Modern UI
 */

// ==================== CONSTANTS ====================
const API_BASE = window.location.origin;
let currentUser = null;
let projects = [];
let currentProject = null;
let products = [];
let productsPage = 1;
const productsPerPage = 15;

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
    
    // Load initial data
    await loadProjects();
    loadDashboardStats();
    initCharts();
    
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
        'feed-guide': 'Формат фида'
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
    document.getElementById('projectFeedUrl').value = '';
    document.getElementById('projectName').focus();
}

function closeCreateProjectModal() {
    document.getElementById('createProjectModal').classList.remove('active');
}

async function createProject() {
    const name = document.getElementById('projectName').value.trim();
    const domain = document.getElementById('projectDomain').value.trim();
    const feedUrl = document.getElementById('projectFeedUrl').value.trim();
    
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
    document.getElementById('projectFeedUrl').value = project.feed_url || '';
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
    
    currentProject = project;
    
    // Update UI
    document.getElementById('projectDetailName').textContent = project.name;
    document.getElementById('projectDetailDomain').textContent = project.domain || 'Домен не указан';
    
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

async function loadSearchSettings() {
    if (!currentProject) return;
    
    const select = document.getElementById('relatedProductsField');
    const limitInput = document.getElementById('relatedProductsLimit');
    const saveBtn = document.getElementById('saveSearchSettingsBtn');
    const statusEl = document.getElementById('searchSettingsStatus');
    
    if (!select || !limitInput) return;
    
    // Reset
    select.innerHTML = '<option value="">Отключено</option>';
    searchSettingsChanged = false;
    saveBtn.disabled = true;
    statusEl.textContent = '';
    
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
            
            sortedFields.forEach(field => {
                const opt = document.createElement('option');
                opt.value = field;
                opt.textContent = field;
                select.appendChild(opt);
            });
        }
        
        // Load current settings
        const settings = await fetchAPI(`/api/v1/projects/${currentProject.id}/search-settings`);
        
        if (settings.relatedProductsField) {
            select.value = settings.relatedProductsField;
        }
        if (settings.relatedProductsLimit) {
            limitInput.value = settings.relatedProductsLimit;
        }
        
    } catch (err) {
        console.error('Error loading search settings:', err);
        // If feed not loaded, show message
        if (err.message?.includes('404') || err.message?.includes('No products')) {
            statusEl.textContent = 'Сначала загрузите фид';
        }
    }
}

function markSearchSettingsChanged() {
    searchSettingsChanged = true;
    document.getElementById('saveSearchSettingsBtn').disabled = false;
    document.getElementById('searchSettingsStatus').textContent = 'Есть несохранённые изменения';
}

async function saveSearchSettings() {
    if (!currentProject) return;
    
    const select = document.getElementById('relatedProductsField');
    const limitInput = document.getElementById('relatedProductsLimit');
    const saveBtn = document.getElementById('saveSearchSettingsBtn');
    const statusEl = document.getElementById('searchSettingsStatus');
    
    saveBtn.disabled = true;
    statusEl.textContent = 'Сохранение...';
    
    try {
        const settings = {
            relatedProductsField: select.value || null,
            relatedProductsLimit: parseInt(limitInput.value) || 4
        };
        
        await fetchAPI(`/api/v1/projects/${currentProject.id}/search-settings`, {
            method: 'PUT',
            body: JSON.stringify(settings)
        });
        
        searchSettingsChanged = false;
        statusEl.textContent = '✓ Сохранено';
        showToast('Настройки поиска сохранены', 'success');
        
        // Update local project data
        if (currentProject.search_settings) {
            currentProject.search_settings = JSON.stringify(settings);
        }
        
    } catch (err) {
        console.error('Error saving search settings:', err);
        saveBtn.disabled = false;
        statusEl.textContent = 'Ошибка сохранения';
        showToast('Ошибка сохранения настроек', 'error');
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
    
    // Show loading state
    btn.disabled = true;
    btnText.style.display = 'none';
    btnSpinner.style.display = 'inline';
    progressContainer.style.display = 'block';
    statusBadge.className = 'feed-status-badge loading';
    statusBadge.innerHTML = '<span class="status-dot"></span><span>Загрузка...</span>';
    
    // Simulate progress
    let progress = 0;
    const progressFill = document.getElementById('feedProgressFill');
    const progressPercent = document.getElementById('feedProgressPercent');
    const progressText = document.getElementById('feedProgressText');
    
    const progressInterval = setInterval(() => {
        if (progress < 90) {
            progress += Math.random() * 15;
            progress = Math.min(progress, 90);
            progressFill.style.width = progress + '%';
            progressPercent.textContent = Math.round(progress) + '%';
            
            if (progress < 30) {
                progressText.textContent = 'Загрузка фида...';
            } else if (progress < 60) {
                progressText.textContent = 'Парсинг товаров...';
            } else {
                progressText.textContent = 'Индексация...';
            }
        }
    }, 300);
    
    try {
        const startTime = Date.now();
        const result = await fetchAPI(`/api/v1/projects/${currentProject.id}/feed/load`, {
            method: 'POST'
        });
        
        clearInterval(progressInterval);
        
        // Complete progress
        progressFill.style.width = '100%';
        progressPercent.textContent = '100%';
        progressText.textContent = 'Готово!';
        
        // Update project in local array
        const projectIndex = projects.findIndex(p => p.id === currentProject.id);
        if (projectIndex !== -1) {
            projects[projectIndex].products_count = result.products_count;
            projects[projectIndex].categories_count = result.categories_count;
            currentProject = projects[projectIndex];
        }
        
        // Show success
        setTimeout(() => {
            progressContainer.style.display = 'none';
            loadProjectFeedStatus();
            showToast(`Загружено ${result.products_count} товаров`, 'success');
            
            // Update stats
            document.getElementById('projectStatProducts').textContent = result.products_count;
            document.getElementById('projectStatCategories').textContent = result.categories_count || 0;
            
            // Reload projects to update counts
            loadProjects();
        }, 500);
        
    } catch (err) {
        clearInterval(progressInterval);
        progressContainer.style.display = 'none';
        statusBadge.className = 'feed-status-badge error';
        statusBadge.innerHTML = '<span class="status-dot"></span><span>Ошибка</span>';
        showToast(err.message || 'Ошибка загрузки фида', 'error');
    } finally {
        btn.disabled = false;
        btnText.style.display = 'inline';
        btnSpinner.style.display = 'none';
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
        
        // Load products
        const response = await fetchAPI(`/api/v1/projects/${projectId}/products`);
        products = response.products || response || [];
        
        if (products.length > 0) {
            document.getElementById('productsTable').style.display = 'block';
            document.getElementById('feedStats').style.display = 'grid';
            
            // Update stats (учитываем оба формата: available и in_stock)
            const categories = new Set(products.map(p => p.category || p.category_name).filter(Boolean));
            const inStock = products.filter(p => {
                if (p.available !== undefined) return p.available;
                if (p.in_stock !== undefined) return p.in_stock;
                return true;
            }).length;
            
            document.getElementById('feedTotalProducts').textContent = products.length;
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
    
    // Update count
    document.getElementById('productsCount').textContent = `${products.length} товаров`;
    
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
        await fetchAPI(`/api/v1/projects/${projectId}/feed/load`, {
            method: 'POST',
            body: JSON.stringify({ url })
        });
        
        showToast('Фид успешно загружен', 'success');
        updateFeedStatus('success', 'Фид загружен');
        document.getElementById('refreshFeedBtn').style.display = 'block';
        
        // Reload projects and products
        await loadProjects();
        await loadProjectProducts(projectId);
        
    } catch (err) {
        showToast(err.message || 'Ошибка загрузки фида', 'error');
        updateFeedStatus('error', 'Ошибка загрузки');
    } finally {
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
    const settings = project?.widget_settings || {};
    
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
    
    const settings = {
        primaryColor: document.getElementById('widgetPrimaryColor').value,
        textColor: document.getElementById('widgetTextColor').value,
        bgColor: document.getElementById('widgetBgColor').value,
        borderColor: document.getElementById('widgetBorderColor').value,
        borderRadius: parseInt(document.getElementById('widgetBorderRadius').value),
        fontSize: parseInt(document.getElementById('widgetFontSize').value),
        placeholder: document.getElementById('widgetPlaceholder').value,
        showButton: document.getElementById('widgetShowButton').checked,
        showImages: document.getElementById('widgetShowImages').checked
    };
    
    try {
        await fetchAPI(`/api/v1/projects/${projectId}/widget`, {
            method: 'PUT',
            body: JSON.stringify(settings)
        });
        
        showToast('Настройки сохранены', 'success');
        
        // Update local cache
        const project = projects.find(p => p.id === projectId);
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
