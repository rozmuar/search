FROM python:3.11-slim

WORKDIR /app

# Установка системных зависимостей.
# fonts-dejavu-core - шрифт с поддержкой кириллицы для reportlab (счета на оплату) -
# у встроенных PDF-шрифтов reportlab (Helvetica и т.д.) кириллицы нет вообще.
RUN apt-get update && apt-get install -y \
    gcc \
    nginx \
    supervisor \
    openssl \
    fonts-dejavu-core \
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

# Проверка что шрифт для кириллицы в PDF-счетах на месте
RUN test -f /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf && echo "DejaVu font OK"

# Проверка что приложение импортируется
RUN python -c "from src.api.main import app; print('App import OK')"

# Supervisor config - логи uvicorn в stdout для docker logs
#
# startretries=1000000 намеренно огромный: по умолчанию supervisor даёт
# всего 3 попытки перезапуска (startretries=3), после чего помечает процесс
# FATAL и БОЛЬШЕ НИКОГДА не перезапускает сам - autorestart=true тут не
# спасает, это частая ловушка. Из-за этого при временном сбое (Postgres/Redis
# чуть задержались, кратковременная ошибка при старте) uvicorn мог упасть
# в FATAL и не подняться сам - "лечилось" только пересборкой контейнера,
# потому что она перезапускает сам supervisord и сбрасывает счётчик попыток.
RUN echo "[supervisord]\n\
nodaemon=true\n\
\n\
[program:nginx]\n\
command=/usr/sbin/nginx -g 'daemon off;'\n\
autostart=true\n\
autorestart=true\n\
startretries=1000000\n\
stdout_logfile=/dev/stdout\n\
stdout_logfile_maxbytes=0\n\
stderr_logfile=/dev/stderr\n\
stderr_logfile_maxbytes=0\n\
\n\
[program:uvicorn]\n\
command=uvicorn src.api.main:app --host 127.0.0.1 --port 8000 --log-level info\n\
autostart=true\n\
autorestart=true\n\
startretries=1000000\n\
startsecs=3\n\
directory=/app\n\
stdout_logfile=/dev/stdout\n\
stdout_logfile_maxbytes=0\n\
stderr_logfile=/dev/stderr\n\
stderr_logfile_maxbytes=0\n\
" > /etc/supervisor/conf.d/app.conf

# Порты
EXPOSE 80 443

# Запуск через supervisor
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf"]
