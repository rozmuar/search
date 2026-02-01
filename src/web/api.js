/**
 * API клиент для работы с backend
 */

const API = {
    baseUrl: '',  // Пустой - используем относительные пути
    token: localStorage.getItem('authToken'),
    user: JSON.parse(localStorage.getItem('user') || 'null'),

    // Установка токена
    setAuth(token, user) {
        this.token = token;
        this.user = user;
        localStorage.setItem('authToken', token);
        localStorage.setItem('user', JSON.stringify(user));
    },

    // Очистка авторизации
    clearAuth() {
        this.token = null;
        this.user = null;
        localStorage.removeItem('authToken');
        localStorage.removeItem('user');
    },

    // Проверка авторизации
    isAuthenticated() {
        return !!this.token;
    },

    // Получение заголовков
    getHeaders() {
        const headers = {
            'Content-Type': 'application/json'
        };
        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }
        return headers;
    },

    // Базовый запрос
    async request(method, endpoint, data = null) {
        const options = {
            method,
            headers: this.getHeaders()
        };

        if (data && (method === 'POST' || method === 'PUT')) {
            options.body = JSON.stringify(data);
        }

        const response = await fetch(`${this.baseUrl}${endpoint}`, options);
        
        if (response.status === 401) {
            this.clearAuth();
            window.location.href = '/auth.html';
            throw new Error('Unauthorized');
        }

        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.detail || 'Request failed');
        }

        return result;
    },

    // AUTH
    async register(email, password, name) {
        const result = await this.request('POST', '/api/v1/auth/register', { email, password, name });
        this.setAuth(result.access_token, result.user);
        return result;
    },

    async login(email, password) {
        const result = await this.request('POST', '/api/v1/auth/login', { email, password });
        this.setAuth(result.access_token, result.user);
        return result;
    },

    async getMe() {
        return await this.request('GET', '/api/v1/auth/me');
    },

    logout() {
        this.clearAuth();
        window.location.href = '/';
    },

    // PROJECTS
    async getProjects() {
        const result = await this.request('GET', '/api/v1/projects');
        return result.projects || [];
    },

    async createProject(data) {
        return await this.request('POST', '/api/v1/projects', data);
    },

    async getProject(projectId) {
        return await this.request('GET', `/api/v1/projects/${projectId}`);
    },

    async updateProject(projectId, data) {
        return await this.request('PUT', `/api/v1/projects/${projectId}`, data);
    },

    async deleteProject(projectId) {
        return await this.request('DELETE', `/api/v1/projects/${projectId}`);
    },

    async regenerateApiKey(projectId) {
        return await this.request('POST', `/api/v1/projects/${projectId}/regenerate-key`);
    },

    // FEED
    async loadFeed(projectId) {
        return await this.request('POST', `/api/v1/projects/${projectId}/feed/load`);
    },

    async getFeedStatus(projectId) {
        return await this.request('GET', `/api/v1/projects/${projectId}/feed/status`);
    },

    async getProducts(projectId, limit = 50, offset = 0) {
        return await this.request('GET', `/api/v1/projects/${projectId}/products?limit=${limit}&offset=${offset}`);
    },

    // ANALYTICS
    async getAnalytics(projectId, days = 7) {
        return await this.request('GET', `/api/v1/projects/${projectId}/analytics?days=${days}`);
    },

    // WIDGET
    async getWidgetConfig(projectId) {
        return await this.request('GET', `/api/v1/projects/${projectId}/widget`);
    },

    async updateWidgetConfig(projectId, settings) {
        return await this.request('PUT', `/api/v1/projects/${projectId}/widget`, settings);
    },

    // SEARCH (public)
    async search(apiKey, query, limit = 10) {
        let url = `/api/v1/search?api_key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(query)}&limit=${limit}`;
        const response = await fetch(url);
        return await response.json();
    }
};

// Экспорт
window.API = API;
