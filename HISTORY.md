# История разработки

## 2026-09-22 — Исправлена причина, по которой SSL не перевыпускался автоматически

**Время:** ~30 минут.

**Проблема:** сертификат Let's Encrypt для dr-robot.ru не продлевался автоматически.

**Причина:** документация (`STEP_BY_STEP.md`, `DEPLOYMENT.md`) описывала выпуск/продление
через `certbot --nginx`, рассчитанный на nginx, установленный на хосте. В реальности nginx
работает только внутри Docker-контейнера `api` (порты 80/443 проброшены напрямую в
контейнер, см. `docker-compose.yml`). Из-за этого:
- ACME HTTP-01 challenge не доходил до контейнерного nginx: `nginx.conf` отдаёт его из
  `/var/www/certbot`, а этот каталог не был расшарен volume'ом между хостом и контейнером.
- Даже при успешном продлении сертификата на хосте (файлы в `/etc/letsencrypt`, который
  примонтирован в контейнер read-only) nginx внутри контейнера не перечитывал новый
  сертификат — reload-хук был настроен под несуществующий хостовый сервис nginx.

**Исправление:**
- `docker-compose.yml`: добавлен volume `/var/www/certbot:/var/www/certbot`, чтобы
  challenge-файлы хоста были видны контейнерному nginx.
- `STEP_BY_STEP.md`, `DEPLOYMENT.md`: инструкции переписаны на `certbot certonly --webroot`
  + deploy-hook, который выполняет `docker compose exec api nginx -s reload` вместо
  несуществующего `systemctl reload nginx` на хосте.

**Что ещё нужно сделать вручную на сервере** (вне репозитория, требует SSH-доступа):
1. Выпустить/перевыпустить сертификат командой `certbot certonly --webroot -w /var/www/certbot -d dr-robot.ru -d www.dr-robot.ru`.
2. Создать `/etc/letsencrypt/renewal-hooks/deploy/reload-docker-nginx.sh` с командой reload контейнера (см. `STEP_BY_STEP.md`).
3. Проверить `certbot renew --dry-run` и убедиться, что systemd-таймер `certbot.timer` активен (`systemctl status certbot.timer`).

## 2026-10-23 — Redis упирался в OOM при BGSAVE, поиск отваливался 500-кой

**Время:** ~1.5 часа (совместная диагностика с продакшена).

**Проблема:** `/api/v1/widget/{key}/config` и `/api/v1/categories` падали 500 с
`redis.exceptions.ResponseError: MISCONF ... unable to persist to disk`.

**Причина:** на сервере 2GB RAM без swap. Redis форкается для BGSAVE, и под памятью
в ~43Mi available kernel OOM-killer раз за разом убивал форкнутый процесс
(`Background saving terminated by signal 9`, `total_forks` рос без остановки). После
первого неудачного bgsave Redis блокирует все команды записи (`stop-writes-on-bgsave-error`),
отсюда 500-ки на любом эндпоинте, который делает `SET`/`ZINCRBY` в Redis.

**Исправление (временное, на сервере, не в репозитории):**
1. `CONFIG SET stop-writes-on-bgsave-error no` — немедленно разблокировало запись.
2. Добавлен 2GB swap-файл (`/swapfile`) + `vm.overcommit_memory=1` — чтобы форк для
   BGSAVE не убивался OOM-killer'ом.

**Побочный эффект:** после появления swap Redis начал активно в него уходить (`vmstat`:
`so` до 142586 KB/s, iowait до 81%) — наступил своп-трашинг, поиск стал отвечать очень
медленно. Это ожидаемое следствие нехватки RAM, а не новый баг: 2GB суммарно (Postgres +
Redis + API + синхронная CPU/memory-тяжёлая индексация фидов) сервером не покрывается.
**Открытый вопрос, требует решения на уровне инфры:** увеличить RAM на VPS (минимум
до 4GB) либо развести по времени автообновление фидов (`src/feed/scheduler.py`), чтобы
не совпадало с пиковой нагрузкой поиска.

## 2026-10-23 — Статистика популярных запросов не сохранялась надёжно

**Время:** ~45 минут.

**Проблема:** подсказки "самое популярное" (`/api/v1/popular`) не отражали реальную
историю поиска, пользователь не находил данных и в Postgres.

**Причина:** `get_popular_queries` в `storage.py` читал только Redis zset
(`analytics:{project_id}:popular_queries`) без бэкапа на чтение. Бэкап на запись в
Postgres (`analytics_popular_queries`, таблица создаётся в `Database._init_tables()`)
существовал, но его ошибки молча проглатывались (`except Exception: pass`) — то есть
если запись в БД по любой причине падала (в частности, на фоне инцидента с Redis/OOM
выше), это было невозможно заметить.

**Исправление:**
- `src/api/database.py`: добавлен `Database.get_popular_queries()` (чтение из Postgres).
- `src/api/storage.py`: `get_popular_queries()` теперь читает из Postgres, а не Redis;
  ошибка бэкапа теперь логируется (`logger.error`), а не проглатывается молча.

## 2026-10-29 — Диск сервера забился логами Redis, поиск отвалился снова

**Время:** ~20 минут.

**Проблема:** поиск снова встал, `docker compose exec` падал с
`write ... no space left on device` — диск оказался заполнен, Postgres и Redis
перешли в `unhealthy`.

**Причина:** у `docker-compose.yml` не было лимита на размер json-file лога контейнеров.
Redis несколько дней подряд (см. инцидент 2026-10-23 выше) писал в stdout повторяющиеся
сообщения `Background saving terminated by signal 9` и крэш-дампы (`CLIENT LIST`,
`FAST MEMORY TEST` и т.п.) — файл `.../*-json.log` контейнера redis разросся до 1.9GB и
забил диск целиком.

**Исправление:**
- Экстренно: `truncate -s 0` на разросшийся лог-файл контейнера — освободило место без
  потери данных контейнеров.
- `docker-compose.yml`: добавлен общий `x-logging` якорь с `max-size: "10m"`,
  `max-file: "3"` для всех трёх сервисов — теперь логи не могут разрастись
  бесконтрольно и забить диск повторно.
