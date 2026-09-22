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
