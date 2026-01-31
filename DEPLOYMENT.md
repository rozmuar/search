# 🚀 Развертывание на Ubuntu 24.04

Пошаговая инструкция для запуска проекта на чистом сервере Ubuntu 24.04.

## 📋 Быстрый старт

```bash
# 1. Установка Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
newgrp docker

# 2. Клонирование проекта
git clone https://github.com/rozmuar/search.git
cd search

# 3. Настройка окружения
cp .env.example .env

# 4. Запуск
docker compose up -d

# 5. Проверка
curl http://localhost:8000/health
```

Готово! API доступен на `http://your-server-ip:8000`

---

## 🔧 Детальная инструкция

### Шаг 1: Обновление системы

```bash
sudo apt update && sudo apt upgrade -y
```

### Шаг 2: Установка Docker

```bash
# Установка Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Добавление пользователя в группу docker
sudo usermod -aG docker $USER

# Применение изменений (или перелогиньтесь)
newgrp docker

# Проверка установки
docker --version
docker compose version
```

Должно вывести что-то вроде:
```
Docker version 25.0.0
Docker Compose version v2.24.0
```

### Шаг 3: Клонирование репозитория

```bash
# Установка git (если нужно)
sudo apt install git -y

# Клонирование
git clone https://github.com/rozmuar/search.git
cd search
```

### Шаг 4: Настройка окружения

```bash
# Создание .env файла
cp .env.example .env

# Опционально: отредактируйте настройки
nano .env
```

Основные параметры в `.env`:
```env
# Redis
REDIS_HOST=redis
REDIS_PORT=6379

# PostgreSQL
POSTGRES_USER=search_user
POSTGRES_PASSWORD=your_secure_password_here
POSTGRES_DB=search_db
POSTGRES_HOST=postgres
POSTGRES_PORT=5432

# API
API_HOST=0.0.0.0
API_PORT=8000
LOG_LEVEL=info
```

### Шаг 5: Запуск сервисов

```bash
# Запуск в фоновом режиме
docker compose up -d

# Просмотр логов
docker compose logs -f

# Проверка статуса
docker compose ps
```

Вы должны увидеть 3 контейнера:
- `search-redis` - Redis для индексов
- `search-postgres` - PostgreSQL для метаданных
- `search-api` - FastAPI приложение

### Шаг 6: Инициализация базы данных

```bash
# База создастся автоматически при первом запуске
# Проверка подключения к БД
docker compose exec postgres psql -U search_user -d search_db -c "\dt"
```

### Шаг 7: Тестирование

```bash
# Проверка здоровья API
curl http://localhost:8000/health

# Индексация тестовых данных
python3 scripts/test_search.py

# Тестовый поиск
curl "http://localhost:8000/api/v1/search?q=iphone&limit=5"
```

---

## 🌐 Настройка для продакшена

### 1. Установка Nginx

```bash
sudo apt install nginx -y
```

### 2. Настройка Nginx как reverse proxy

```bash
sudo nano /etc/nginx/sites-available/search
```

Добавьте конфигурацию:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # API
    location /api {
        proxy_pass http://localhost:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Web интерфейс
    location / {
        root /var/www/search;
        try_files $uri $uri/ /index.html;
    }

    # Swagger docs
    location /docs {
        proxy_pass http://localhost:8000/docs;
        proxy_set_header Host $host;
    }
}
```

### 3. Копирование веб-файлов

```bash
# Создание директории
sudo mkdir -p /var/www/search

# Копирование файлов
sudo cp -r src/web/* /var/www/search/

# Настройка прав
sudo chown -R www-data:www-data /var/www/search
```

### 4. Активация конфигурации

```bash
# Создание симлинка
sudo ln -s /etc/nginx/sites-available/search /etc/nginx/sites-enabled/

# Проверка конфигурации
sudo nginx -t

# Перезапуск Nginx
sudo systemctl restart nginx
```

### 5. Установка SSL (Let's Encrypt)

```bash
# Установка certbot
sudo apt install certbot python3-certbot-nginx -y

# Получение сертификата
sudo certbot --nginx -d your-domain.com

# Автообновление сертификата настроится автоматически
```

---

## 🔒 Безопасность

### 1. Настройка файрвола

```bash
# Установка UFW
sudo apt install ufw -y

# Разрешаем SSH
sudo ufw allow OpenSSH

# Разрешаем HTTP и HTTPS
sudo ufw allow 'Nginx Full'

# Включаем файрвол
sudo ufw enable

# Проверка статуса
sudo ufw status
```

### 2. Изменение паролей

Обязательно смените пароли в `.env`:
```bash
nano .env
# Измените POSTGRES_PASSWORD на надежный пароль
```

Пересоздайте контейнеры:
```bash
docker compose down -v
docker compose up -d
```

### 3. Ограничение доступа к портам

По умолчанию API слушает `0.0.0.0:8000`. Для продакшена лучше слушать только локально:

В `docker-compose.yml`:
```yaml
services:
  api:
    ports:
      - "127.0.0.1:8000:8000"  # Только локальный доступ
```

---

## 📊 Мониторинг

### Проверка логов

```bash
# Все сервисы
docker compose logs -f

# Только API
docker compose logs -f api

# Последние 100 строк
docker compose logs --tail=100
```

### Проверка использования ресурсов

```bash
# Статистика контейнеров
docker stats

# Использование диска
df -h
docker system df
```

### Автозапуск после перезагрузки

Контейнеры настроены на автозапуск (`restart: unless-stopped` в docker-compose.yml).

Проверка:
```bash
sudo reboot
# После перезагрузки
docker compose ps
```

---

## 🔄 Обновление проекта

```bash
# Переход в директорию проекта
cd ~/search

# Получение изменений
git pull

# Пересборка и перезапуск
docker compose down
docker compose up -d --build

# Проверка
curl http://localhost:8000/health
```

---

## 🆘 Решение проблем

### Контейнеры не запускаются

```bash
# Просмотр логов
docker compose logs

# Проверка портов
sudo netstat -tulpn | grep -E '6379|5432|8000'

# Очистка и перезапуск
docker compose down -v
docker compose up -d
```

### API недоступен

```bash
# Проверка статуса контейнера
docker compose ps

# Проверка здоровья
docker compose exec api curl http://localhost:8000/health

# Проверка файрвола
sudo ufw status
```

### Ошибка подключения к БД

```bash
# Проверка PostgreSQL
docker compose exec postgres psql -U search_user -d search_db -c "SELECT version();"

# Пересоздание БД
docker compose down postgres
docker volume rm search_postgres_data
docker compose up -d
```

### Недостаточно памяти

```bash
# Проверка памяти
free -h

# Очистка неиспользуемых образов
docker system prune -a

# Настройка swap (если нужно)
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## 📈 Производительность

### Рекомендуемые ресурсы сервера

**Минимальные требования:**
- CPU: 2 cores
- RAM: 2 GB
- Disk: 10 GB

**Рекомендуемые:**
- CPU: 4 cores
- RAM: 4 GB
- Disk: 20 GB SSD

### Оптимизация Redis

В `docker-compose.yml` можно добавить:
```yaml
services:
  redis:
    command: redis-server --maxmemory 512mb --maxmemory-policy allkeys-lru
```

### Горизонтальное масштабирование

Для высоких нагрузок можно запустить несколько инстансов API:
```bash
docker compose up -d --scale api=3
```

Настройте балансировку в Nginx:
```nginx
upstream search_api {
    server localhost:8000;
    server localhost:8001;
    server localhost:8002;
}
```

---

## 📞 Полезные команды

```bash
# Остановка всех сервисов
docker compose down

# Перезапуск
docker compose restart

# Просмотр использования ресурсов
docker stats

# Очистка старых образов и контейнеров
docker system prune -a

# Резервное копирование PostgreSQL
docker compose exec postgres pg_dump -U search_user search_db > backup.sql

# Восстановление PostgreSQL
cat backup.sql | docker compose exec -T postgres psql -U search_user search_db
```

---

## ✅ Чеклист после установки

- [ ] Docker установлен и работает
- [ ] Проект склонирован из Git
- [ ] Файл .env настроен
- [ ] Все контейнеры запущены (`docker compose ps`)
- [ ] API отвечает на `/health`
- [ ] Тестовый поиск работает
- [ ] Nginx настроен (для продакшена)
- [ ] SSL сертификат установлен (для продакшена)
- [ ] Файрвол настроен
- [ ] Пароли изменены на надежные
- [ ] Логи проверены на ошибки

---

Готово! 🎉 Ваш сервис поиска запущен и готов к работе.

Документация API: `http://your-server-ip:8000/docs`
