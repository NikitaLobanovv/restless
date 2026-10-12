SHELL := /bin/bash
.DEFAULT_GOAL := help
COMPOSE := docker compose --env-file .env
LOAD_ENV := set -a && . ./.env && set +a
BACKUP_KEEP ?= 7

.PHONY: help up env check-env install db migrate dev down reset logs psql \
        test test-int e2e lint dist dist-docker backup restore

help: ## Список команд
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
	  awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

up: env install migrate dev ## Развернуть всё и запустить приложение

env: ## Создать .env из шаблона, если его нет
	@test -f .env || cp .env.example .env

check-env: env ## Проверить, что DATABASE_URL согласован с POSTGRES_*
	@$(LOAD_ENV) && node docker/check-env.mjs

install: ## Установить npm-зависимости
	npm ci

db: check-env ## Поднять PostgreSQL, тестовый API и ежедневные бэкапы
	@mkdir -p backups
	$(COMPOSE) --profile dev up -d --wait db echo-api
	$(COMPOSE) --profile dev up -d backup

migrate: db ## Применить миграции
	$(COMPOSE) run --rm --build migrate

dev: env ## Запустить Electron в dev-режиме
	$(LOAD_ENV) && npm run dev

down: ## Остановить контейнеры (данные сохраняются)
	$(COMPOSE) --profile dev --profile test down

reset: ## Удалить БД вместе с данными и развернуть заново
	$(COMPOSE) --profile dev --profile test down -v
	$(MAKE) migrate

logs: ## Логи PostgreSQL
	$(COMPOSE) logs -f db

psql: ## Консоль psql
	$(COMPOSE) exec db sh -c 'psql -U "$$POSTGRES_USER" "$$POSTGRES_DB"'

test: ## Unit-тесты
	npm run test

test-int: check-env ## Интеграционные тесты против БД и echo-api
	$(COMPOSE) --profile test up -d --wait db echo-api
	$(COMPOSE) run --rm --build migrate
	$(LOAD_ENV) && npm run test:integration

e2e: migrate ## E2E-тесты Playwright
	$(LOAD_ENV) && npm run test:e2e

lint: ## Линтер и проверка типов
	npm run lint && npm run typecheck

dist: ## Инсталлятор для текущей ОС
	npm run dist

dist-docker: ## Инсталляторы Linux и Windows в контейнере
	$(COMPOSE) --profile build run --rm builder \
	  bash -c "npm ci && npx electron-builder --linux --win"

backup: ## Дамп БД в backups/ (хранятся последние 7)
	@mkdir -p backups
	$(COMPOSE) exec -T db sh -c 'pg_dump -U "$$POSTGRES_USER" -Fc "$$POSTGRES_DB"' \
	  > backups/restless-$$(date +%F-%H%M).dump
	@ls -1t backups/restless-*.dump | tail -n +$$(( $(BACKUP_KEEP) + 1 )) | xargs -r rm -f --
	@ls -1t backups/restless-*.dump

restore: ## Восстановить дамп: make restore FILE=backups/<file>.dump
	@test -n "$(FILE)" || (echo "Укажите FILE=..." && exit 1)
	$(COMPOSE) exec -T db sh -c 'pg_restore --clean --if-exists -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"' \
	  < $(FILE)
