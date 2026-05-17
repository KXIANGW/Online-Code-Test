SHELL := /bin/bash

.PHONY: bootstrap up up-build down logs ps clean rebuild psql sandbox-images test help \
        demo-up demo-seed demo-load demo-watch demo-100 demo-down demo-urls

help:
	@echo "Online Code Test — M2 async judge"
	@echo ""
	@echo "  make bootstrap      Copy .env.example to .env (idempotent)"
	@echo "  make up             Build sandbox images, then docker compose up -d --build"
	@echo "  make down           docker compose down"
	@echo "  make logs           Tail logs from all services"
	@echo "  make ps             Show service health"
	@echo "  make clean          docker compose down -v (drops volumes)"
	@echo "  make rebuild        clean + up (full reset)"
	@echo "  make psql           Open psql shell inside the postgres container"
	@echo "  make sandbox-images Build judge sandbox images"
	@echo "  make test           Run lint + test + build (mirrors CI)"
	@echo ""
	@echo "  Demo (Phase A+B+C — 100 concurrent observability):"
	@echo "  make demo-up        Build sandbox images, bring full stack + prom/grafana/cadvisor"
	@echo "  make demo-seed      Provision 100 candidates + sessions (loadtest/seed.ts)"
	@echo "  make demo-load      Run k6 burst of 100 concurrent submissions"
	@echo "  make demo-watch     Run scale-watcher.sh (Ctrl-C to stop)"
	@echo "  make demo-100       demo-up -> demo-seed -> watcher (bg) -> demo-load"
	@echo "  make demo-down      docker compose down -v + remove session-tokens.json"
	@echo "  make demo-urls      Print Grafana / Prometheus / RabbitMQ / cAdvisor URLs"

bootstrap:
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "Created .env from .env.example. Edit POSTGRES_PASSWORD before deploying."; \
	else \
		echo ".env already exists; leaving untouched."; \
	fi

up: bootstrap sandbox-images
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
	cd backend && npm run lint && npm test
	cd frontend && npm run lint && npm test && npm run build

sandbox-images:
	$(MAKE) -C worker build-sandbox-images

# ── Demo: 100 concurrent observability ────────────────────────────────────
# Pre-req:
#   - .env exists (make bootstrap will create it).
#   - The scenario problem PROBLEM_ID=1 from infra/postgres/10-scenarios.sql
#     accepts an echo-style AC solution; if you swap it, also swap the
#     fixtures source loadtest/fixtures/ac.py.
#   - tsx (npx) on the host for `make demo-seed`. No global install needed.
#   - 'jq' on the host for the scale-watcher.

DEMO_VUS ?= 100
DEMO_N ?= 100
DEMO_BASE_URL ?= http://localhost:3000/api

demo-up: bootstrap sandbox-images
	docker compose up -d --build

demo-seed:
	cd loadtest && N=$(DEMO_N) BASE_URL=$(DEMO_BASE_URL) npx --yes tsx seed.ts

demo-load:
	docker run --rm --network oct_default \
	  -v $(PWD)/loadtest:/scripts \
	  -e BASE_URL=http://backend:3000/api \
	  -e VUS=$(DEMO_VUS) \
	  grafana/k6 run /scripts/k6-submit.js

demo-watch:
	./loadtest/scale-watcher.sh

demo-100: demo-up
	@echo "[demo-100] waiting for backend healthy..."
	@until docker compose ps backend --format '{{.Status}}' | grep -q healthy; do sleep 2; done
	@$(MAKE) demo-seed
	@echo "[demo-100] starting scale-watcher in background (logs -> /tmp/oct-scale-watcher.log)"
	@nohup ./loadtest/scale-watcher.sh > /tmp/oct-scale-watcher.log 2>&1 &
	@sleep 3
	@$(MAKE) demo-load
	@echo
	@$(MAKE) demo-urls
	@echo "[demo-100] watcher still running; 'pkill -f scale-watcher.sh' to stop."

demo-down:
	docker compose down -v
	rm -f loadtest/.session-tokens.json
	-pkill -f scale-watcher.sh 2>/dev/null || true

demo-urls:
	@echo "Frontend  : http://localhost:$${FRONTEND_PORT:-5173}"
	@echo "Backend   : http://localhost:$${HOST_BACKEND_PORT:-3000}/api/health"
	@echo "  metrics : http://localhost:$${HOST_BACKEND_PORT:-3000}/api/metrics"
	@echo "Grafana   : http://localhost:$${HOST_GRAFANA_PORT:-3001}  (anonymous viewer; admin/oct_dev_grafana)"
	@echo "  dash    : http://localhost:$${HOST_GRAFANA_PORT:-3001}/d/oct-demo"
	@echo "Prometheus: http://localhost:$${HOST_PROMETHEUS_PORT:-9090}/targets"
	@echo "RabbitMQ  : http://localhost:$${HOST_RABBITMQ_MGMT_PORT:-15672}  (oct / oct_dev_password)"
	@echo "cAdvisor  : http://localhost:$${HOST_CADVISOR_PORT:-8081}"
