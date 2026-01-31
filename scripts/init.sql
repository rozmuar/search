-- Инициализация базы данных PostgreSQL
CREATE TABLE IF NOT EXISTS projects (
    id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    domain VARCHAR(255) NOT NULL,
    api_key VARCHAR(64) UNIQUE NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS feeds (
    id VARCHAR(32) PRIMARY KEY,
    project_id VARCHAR(32) REFERENCES projects(id),
    type VARCHAR(20) NOT NULL,
    url TEXT NOT NULL,
    format VARCHAR(10) DEFAULT 'xml',
    update_interval INTEGER DEFAULT 3600,
    last_update TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Создаем демо проект
INSERT INTO projects (id, name, domain, api_key) 
VALUES ('demo', 'Demo Project', 'demo.local', 'sk_demo_12345')
ON CONFLICT (id) DO NOTHING;
