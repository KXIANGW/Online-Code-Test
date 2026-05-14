SHELL := /bin/bash

.PHONY: bootstrap up up-build down logs ps clean rebuild psql sandbox-images test help

help:
	@echo "Online Code Test — M2 async judge"
	@echo ""
	@echo "  make bootstrap   Copy .env.example to .env (idempotent)"
	@echo "  make up          docker compose up -d --build"
	@echo "  make down        docker compose down"
	@echo "  make logs        Tail logs from all services"
	@echo "  make ps          Show service health"
	@echo "  make clean       docker compose down -v (drops volumes)"
	@echo "  make rebuild     clean + up (full reset)"
	@echo "  make psql        Open psql shell inside the postgres container"
	@echo "  make sandbox-images Build judge sandbox images"
	@echo "  make test        Run backend then frontend test suites"

bootstrap:
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "Created .env from .env.example. Edit POSTGRES_PASSWORD before deploying."; \
	else \
		echo ".env already exists; leaving untouched."; \
	fi

up: bootstrap
	docker compose up -d --build

up-build: up

down:
	docker compose down

logs:
	docker compose logs -f

ps:
	docker compose ps

clean:
	docker compose down -v

rebuild: clean up

psql:
	docker compose exec -it postgres psql -U $${POSTGRES_USER:-oct} -d $${POSTGRES_DB:-oct}

test:
	cd backend && npm test
	cd frontend && npm test

sandbox-images:
	docker build -t oj-sandbox-cpp ./worker/sandbox/cpp
	docker build -t oj-sandbox-python ./worker/sandbox/python
