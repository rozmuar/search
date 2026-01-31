// Dashboard JavaScript

// Navigation
document.addEventListener('DOMContentLoaded', function() {
    // Handle navigation
    const navItems = document.querySelectorAll('.nav-item[data-section]');
    navItems.forEach(item => {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            const section = this.getAttribute('data-section');
            showSection(section);
        });
    });

    // Auto-run search test if query in URL
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('test')) {
        showSection('search-test');
    }
});

function showSection(sectionName) {
    // Update navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        if (item.getAttribute('data-section') === sectionName) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    // Update sections
    document.querySelectorAll('.content-section').forEach(section => {
        section.classList.remove('active');
    });
    document.getElementById(sectionName + '-section').classList.add('active');

    // Update page title
    const titles = {
        'overview': 'Обзор',
        'projects': 'Мои проекты',
        'search-test': 'Тест поиска',
        'analytics': 'Аналитика',
        'settings': 'Настройки'
    };
    document.getElementById('pageTitle').textContent = titles[sectionName] || 'Dashboard';
}

// Search Test
async function runSearchTest() {
    const input = document.getElementById('testSearchInput');
    const results = document.getElementById('testResults');
    const query = input.value.trim();

    if (!query) {
        results.innerHTML = '<p style="color: var(--danger);">Введите поисковый запрос</p>';
        return;
    }

    results.innerHTML = '<p style="color: var(--secondary);">Поиск...</p>';

    try {
        const projectId = document.getElementById('testProjectSelect').value;
        const inStock = document.getElementById('testInStock').checked;

        const params = new URLSearchParams({
            q: query,
            project_id: projectId,
            limit: 10
        });

        if (inStock) {
            params.append('in_stock', 'true');
        }

        const response = await fetch(`http://localhost:8000/api/v1/search?${params}`);
        
        if (!response.ok) {
            throw new Error('Search failed');
        }

        const data = await response.json();

        if (data.items && data.items.length > 0) {
            displayTestResults(data);
        } else {
            results.innerHTML = '<p style="color: var(--secondary);">Ничего не найдено</p>';
        }
    } catch (error) {
        console.error('Search error:', error);
        results.innerHTML = `
            <div class="alert alert-warning">
                <strong>⚠️ Ошибка подключения к API</strong><br>
                <small>Убедитесь, что сервис запущен: <code>docker-compose up -d</code></small>
            </div>
        `;
    }
}

function displayTestResults(data) {
    const results = document.getElementById('testResults');
    
    let html = `
        <div style="margin-bottom: 1rem; padding: 0.75rem; background: white; border-radius: 8px;">
            <strong>Найдено:</strong> ${data.total} товаров
            <span style="color: var(--secondary); margin-left: 1rem;">
                Время: ${data.meta.took_ms}ms
            </span>
        </div>
    `;

    html += data.items.map(item => `
        <div class="result-item">
            <h4>${item.name}</h4>
            <div class="result-meta">
                <span style="color: var(--primary); font-weight: 600;">${formatPrice(item.price)} ₽</span>
                <span>Score: ${item.score}</span>
                <span style="color: ${item.in_stock ? 'var(--success)' : 'var(--danger)'}">
                    ${item.in_stock ? '✓ В наличии' : 'Нет в наличии'}
                </span>
            </div>
            ${item.description ? `<p style="color: var(--secondary); font-size: 0.875rem; margin-top: 0.5rem;">${item.description.substring(0, 150)}...</p>` : ''}
        </div>
    `).join('');

    results.innerHTML = html;
}

function formatPrice(price) {
    return price.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

// Projects
function showCreateProjectModal() {
    const modal = document.getElementById('createProjectModal');
    modal.classList.add('active');
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.classList.remove('active');
}

function createProject() {
    // Mock project creation
    alert('Проект будет создан! (функция в разработке)');
    closeModal('createProjectModal');
}

function showApiKey(projectId) {
    const modal = document.getElementById('apiKeyModal');
    modal.classList.add('active');
    
    // In real app, fetch API key from backend
    document.getElementById('apiKeyValue').textContent = `sk_${projectId}_${generateRandomKey()}`;
}

function generateRandomKey() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

function copyApiKey() {
    const apiKey = document.getElementById('apiKeyValue').textContent;
    navigator.clipboard.writeText(apiKey).then(() => {
        alert('API ключ скопирован в буфер обмена!');
    });
}

function testProject(projectId) {
    showSection('search-test');
    document.getElementById('testProjectSelect').value = projectId;
}

// Utility functions
function openDocs() {
    window.open('http://localhost:8000/docs', '_blank');
}

function logout() {
    if (confirm('Вы уверены, что хотите выйти?')) {
        // Clear session and redirect to landing
        window.location.href = 'index.html';
    }
}

// Close modal on outside click
window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.classList.remove('active');
    }
}

// Live search in test panel
let searchDebounce;
document.getElementById('testSearchInput')?.addEventListener('input', function(e) {
    clearTimeout(searchDebounce);
    
    if (e.target.value.length >= 2) {
        searchDebounce = setTimeout(() => {
            // Auto-search could be implemented here
        }, 500);
    }
});

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
    // Ctrl/Cmd + K to focus search
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        showSection('search-test');
        setTimeout(() => {
            document.getElementById('testSearchInput')?.focus();
        }, 100);
    }

    // ESC to close modals
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal.active').forEach(modal => {
            modal.classList.remove('active');
        });
    }
});
