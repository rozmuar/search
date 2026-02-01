FROM python:3.11-slim

WORKDIR /app

# Установка системных зависимостей
RUN apt-get update && apt-get install -y \
    gcc \
    nginx \
    supervisor \
    openssl \
    && rm -rf /var/lib/apt/lists/*

# Создание директорий для SSL и certbot
RUN mkdir -p /etc/nginx/ssl /var/www/certbot

# Генерация self-signed SSL сертификата (fallback, будет заменён Let's Encrypt)
RUN openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /etc/nginx/ssl/privkey.pem \
    -out /etc/nginx/ssl/fullchain.pem \
    -subj "/CN=dr-robot.ru/O=SearchPro/C=RU"

# Копирование зависимостей
COPY requirements-basic.txt .

# Установка Python зависимостей
RUN pip install --no-cache-dir -r requirements-basic.txt

# Копирование кода
COPY src /app/src
COPY nginx.conf /etc/nginx/sites-available/default

# Создаём скрипты если их нет
RUN mkdir -p /app/scripts

# Проверка что PyJWT установлен
RUN python -c "import jwt; print('PyJWT OK')"

# Проверка что приложение импортируется
RUN python -c "from src.api.main import app; print('App import OK')"

# Supervisor config
RUN echo "[supervisord]\n\
nodaemon=true\n\
\n\
[program:nginx]\n\
command=/usr/sbin/nginx -g 'daemon off;'\n\
autostart=true\n\
autorestart=true\n\
\n\
[program:uvicorn]\n\
command=uvicorn src.api.main:app --host 127.0.0.1 --port 8000\n\
autostart=true\n\
autorestart=true\n\
directory=/app\n\
" > /etc/supervisor/conf.d/app.conf

# Порты
EXPOSE 80 443

# Запуск через supervisor
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf"]
