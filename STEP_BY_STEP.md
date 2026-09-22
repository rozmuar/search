# 🚀 Пошаговая инструкция деплоя SearchPro

## Требования
- Сервер с Ubuntu 24.04
- Минимум 2GB RAM, 2 CPU cores
- Доменное имя (опционально)

## Шаг 1: Подключение к серверу

```bash
ssh root@YOUR_SERVER_IP
```

## Шаг 2: Установка Docker

```bash
# Обновляем систему
apt update && apt upgrade -y

# Устанавливаем Docker
curl -fsSL https://get.docker.com | sh

# Запускаем Docker
systemctl enable docker
systemctl start docker

# Проверяем
docker --version
```

## Шаг 3: Установка Docker Compose

```bash
apt install docker-compose-plugin -y

# Проверяем
docker compose version
```

## Шаг 4: Клонирование проекта

```bash
cd /opt
git clone https://github.com/YOUR_USERNAME/search.git search
cd search
```

## Шаг 5: Запуск

```bash
# Собираем и запускаем
docker compose up -d --build

# Проверяем статус
docker compose ps

# Смотрим логи
docker compose logs -f
```

## Шаг 6: Проверка

Откройте в браузере:
- `http://YOUR_SERVER_IP` - лендинг
- `http://YOUR_SERVER_IP/auth.html` - авторизация
- `http://YOUR_SERVER_IP/dashboard.html` - личный кабинет
- `http://YOUR_SERVER_IP/docs` - API документация

## Шаг 7: Настройка домена (опционально)

### С Cloudflare
1. Добавьте домен в Cloudflare
2. Создайте A-запись: `@ -> YOUR_SERVER_IP`
3. Включите проксирование (оранжевое облако)
4. В разделе SSL/TLS выберите "Full"

### Без Cloudflare (Let's Encrypt)

Nginx здесь работает не на хосте, а внутри Docker-контейнера `api`
(см. `Dockerfile`/`nginx.conf`), поэтому плагин `certbot --nginx` не подходит —
ему нечем управлять на хосте. Вместо него используем webroot-метод: каталог
`/var/www/certbot` на хосте проброшен volume'ом в контейнер
(`docker-compose.yml`) и отдаётся контейнерным nginx по пути
`/.well-known/acme-challenge/`.

```bash
# Устанавливаем Certbot без nginx-плагина
apt install certbot -y

# Каталог для ACME-challenge (тот же, что смонтирован в контейнер)
mkdir -p /var/www/certbot

# Контейнер должен быть уже запущен (docker compose up -d), чтобы отдавать
# challenge-файлы. Получаем сертификат:
certbot certonly --webroot -w /var/www/certbot -d yourdomain.com

# certbot renew обновит файлы в /etc/letsencrypt на хосте, но nginx внутри
# контейнера не подхватит их без reload - хука на "systemctl reload nginx"
# тут нет и быть не может, т.к. nginx не сервис хоста. Добавляем deploy-hook,
# который перезагружает nginx внутри контейнера:
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-docker-nginx.sh <<'EOF'
#!/bin/sh
docker compose -f /opt/search/docker-compose.yml exec -T api nginx -s reload
EOF
chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-docker-nginx.sh

# Проверяем, что продление и хук отрабатывают без ошибок
certbot renew --dry-run
```

## Команды управления

```bash
# Перезапуск
docker compose restart

# Остановка
docker compose down

# Обновление кода
git pull
docker compose up -d --build

# Просмотр логов
docker compose logs api
docker compose logs redis

# Очистка данных (ОСТОРОЖНО!)
docker compose down -v
```

## Тестирование API

```bash
# Health check
curl http://localhost/health

# Регистрация
curl -X POST http://localhost/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123","name":"Test User"}'

# Поиск
curl "http://localhost/api/v1/search?q=телефон&project_id=demo"
```

## Troubleshooting

### Порт 80 занят
```bash
# Найти процесс
lsof -i :80

# Остановить nginx если установлен
systemctl stop nginx
systemctl disable nginx
```

### Ошибки Docker
```bash
# Очистка
docker system prune -a

# Пересборка
docker compose build --no-cache
docker compose up -d
```

### Логи ошибок
```bash
# Все логи
docker compose logs

# Только ошибки
docker compose logs | grep -i error
```

## Структура проекта

```
/opt/search/
├── docker-compose.yml  # Конфигурация Docker
├── Dockerfile          # Образ приложения
├── nginx.conf          # Конфиг веб-сервера
├── src/
│   ├── api/           # Backend API
│   ├── web/           # Frontend (лендинг, dashboard)
│   ├── search/        # Поисковый движок
│   └── feed/          # Парсер фидов
└── requirements-basic.txt
```
