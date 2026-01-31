# ⚡ Шпаргалка по запуску - 3 минуты

## Минимальный запуск

```powershell
# 1. Запуск
docker-compose up -d

# 2. Ждём 15 секунд
Start-Sleep -Seconds 15

# 3. Тест
pip install httpx
python scripts/test_search.py
```

## Проверка

```powershell
# Health check
curl http://localhost:8000/health

# Документация API
start http://localhost:8000/docs
```

## Быстрые тесты

```powershell
# Поиск
curl "http://localhost:8000/api/v1/search?q=iphone&project_id=demo"

# Подсказки
curl "http://localhost:8000/api/v1/suggest?q=app&project_id=demo"
```

## Управление

```powershell
# Логи
docker-compose logs -f api

# Перезапуск
docker-compose restart

# Остановка
docker-compose down

# Полная очистка
docker-compose down -v
```

## Troubleshooting

### Порты заняты?

```powershell
# Проверить что слушает порты
netstat -ano | findstr :8000
netstat -ano | findstr :6379
netstat -ano | findstr :5432
```

### Redis не отвечает?

```powershell
docker-compose exec redis redis-cli ping
# Должно вернуть: PONG
```

### API не стартует?

```powershell
# Смотрим логи
docker-compose logs api

# Перезапускаем
docker-compose restart api
```

## Полная документация

- **Быстрый старт**: [START_HERE.md](START_HERE.md)
- **Подробно**: [QUICKSTART.md](QUICKSTART.md)

---

**Всё!** Базовая версия работает без ML и GPU. 🎉
