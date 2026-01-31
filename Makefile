# Makefile для удобного управления проектом

.PHONY: help up down logs restart test clean install

help: ## Показать эту справку
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

up: ## Запустить все сервисы
	docker-compose up -d

down: ## Остановить все сервисы
	docker-compose down

logs: ## Показать логи
	docker-compose logs -f

restart: ## Перезапустить сервисы
	docker-compose restart

build: ## Пересобрать образы
	docker-compose build

test: ## Запустить тесты
	python scripts/test_search.py

clean: ## Очистить данные и остановить сервисы
	docker-compose down -v
	rm -rf data/

install: ## Установить зависимости локально
	pip install -r requirements-basic.txt

dev: ## Запустить в режиме разработки
	uvicorn src.api.main:app --reload --host 0.0.0.0 --port 8000

redis-cli: ## Подключиться к Redis CLI
	docker-compose exec redis redis-cli

psql: ## Подключиться к PostgreSQL
	docker-compose exec postgres psql -U search_user -d search_service
