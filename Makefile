SHELL := /bin/bash

.PHONY: bootstrap up up-build down logs ps clean rebuild psql sandbox-images isolate-rootfs dev test coverage help \
        demo-up demo-seed demo-load demo-watch demo-100 demo-down demo-urls EndtoEnd

help:
	@echo "Online Code Test"
	@echo ""
	@echo "  make bootstrap      Copy .env.example to .env (idempotent)"
	@echo "  make dev            Build sandbox rootfs, then start core services only (no monitoring)"
	@echo "  make up             Build sandbox rootfs, then docker compose up -d --build"
	@echo "  make down           docker compose down"
	@echo "  make logs           Tail logs from all services"
	@echo "  make ps             Show service health"
	@echo "  make clean          docker compose down -v (drops volumes)"
	@echo "  make rebuild        clean + up (full reset)"
	@echo "  make psql           Open psql shell inside the postgres container"
	@echo "  make sandbox-images Build judge sandbox images"
	@echo "  make isolate-rootfs Build judge sandbox images and local isolate rootfs"
	@echo "  make test           Run lint + test + build (mirrors CI)"
	@echo "  make coverage       Run coverage for backend/frontend/worker/puller"
	@echo ""
	@echo "  Demo (Phase A+B+C — 100 concurrent observability):"
	@echo "  make demo-up        Build sandbox rootfs, bring full stack + prom/grafana/cadvisor"
	@echo "  make demo-seed      Provision 100 candidates + sessions (loadtest/seed.ts)"
	@echo "  make demo-load      Run k6 burst of 100 concurrent submissions"
	@echo "  make demo-watch     Run scale-watcher.sh (Ctrl-C to stop)"
	@echo "  make demo-100       demo-up -> demo-seed -> watcher (bg) -> demo-load"
	@echo "  make demo-down      docker compose down -v + remove session-tokens.json"
	@echo "  make demo-urls      Print Grafana / Prometheus / RabbitMQ / cAdvisor URLs"
	@echo "  make EndtoEnd       Run API+Browser E2E tests against real Docker services (make up first)"

bootstrap:
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "Created .env from .env.example. Edit POSTGRES_PASSWORD before deploying."; \
	else \
		echo ".env already exists; leaving untouched."; \
	fi

up: bootstrap isolate-rootfs
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
	cd backend && npm run format:check && npm run lint && npm test && npm run build
	cd frontend && npm run format:check && npm run lint && npm test && npm run build
	cd worker && npm run lint && npm test && npm run build
	cd worker/puller && npm run lint && npm test && npm run build

coverage:
	cd backend && npm run coverage
	cd frontend && npm run coverage
	cd worker && npm run coverage
	cd worker/puller && npm run coverage

sandbox-images:
	$(MAKE) -C worker build-sandbox-images

isolate-rootfs:
	$(MAKE) -C worker build-isolate-rootfs

dev: bootstrap isolate-rootfs
	docker compose up -d --build postgres rabbitmq redis backend worker

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
DEMO_FIXTURE ?= ac.py
# Baseline replica count brought up by `make demo-up`. The autoscale demo
# starts at 1 worker and lets scale-watcher fan out to MAX (default 5).
WORKER_REPLICAS ?= 1

demo-up: bootstrap isolate-rootfs
	WORKER_REPLICAS=$(WORKER_REPLICAS) docker compose up -d --build --wait \
	  --scale worker=$(WORKER_REPLICAS)

demo-seed:
	@v=$$(node -e 'console.log(parseInt(process.versions.node.split(".")[0]))' 2>/dev/null); \
	  if [ -z "$$v" ] || [ "$$v" -lt 16 ]; then \
	    echo "ERROR: seed.ts needs Node 16+ (tsx). Found: $$(node --version 2>/dev/null || echo none)." >&2; \
	    echo "       Fix: 'nvm use' (the repo ships an .nvmrc) before running 'make demo-100'." >&2; \
	    exit 1; \
	  fi
	cd loadtest && N=$(DEMO_N) BASE_URL=$(DEMO_BASE_URL) npx --yes tsx seed.ts

demo-load:
	docker run --rm --network oct_default \
	  -v $(PWD)/loadtest:/scripts \
	  -e BASE_URL=http://backend:3000/api \
	  -e VUS=$(DEMO_VUS) \
	  -e FIXTURE=$(DEMO_FIXTURE) \
	  grafana/k6 run /scripts/k6-submit.js

demo-watch:
	./loadtest/scale-watcher.sh

demo-100: demo-up
	@echo "[demo-100] worker replicas: $(WORKER_REPLICAS) (scale-watcher will fan out to MAX=5)"
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

EndtoEnd: isolate-rootfs ## Run full E2E suite (API + Browser) against running Docker stack (run make up first)
	@v=$$(node -e 'console.log(parseInt(process.versions.node.split(".")[0]))' 2>/dev/null); \
	  if [ -z "$$v" ] || [ "$$v" -lt 16 ]; then \
	    echo "ERROR: e2e needs Node 16+. Found: $$(node --version 2>/dev/null || echo none)." >&2; \
	    exit 1; \
	  fi
	docker compose up -d --build worker frontend --wait
	cd e2e && npm install --silent
	@echo "==> [1/2] Running API-level E2E tests (Vitest)..."
	cd e2e && npx vitest run
	@echo "==> [2/2] Running browser E2E tests (Playwright)..."
	cd e2e && npx playwright test
