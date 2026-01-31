FROM python:3.11-slim

WORKDIR /app

# Установка системных зависимостей
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Копирование зависимостей
COPY requirements-basic.txt .

# Установка Python зависимостей
RUN pip install --no-cache-dir -r requirements-basic.txt

# Копирование кода
COPY src /app/src
COPY config /app/config

# Порт API
EXPOSE 8000

# Команда по умолчанию
CMD ["uvicorn", "src.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
