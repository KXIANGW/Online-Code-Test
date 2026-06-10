SHELL := /bin/bash

.PHONY: bootstrap up up-build down logs ps clean rebuild psql sandbox-images isolate-rootfs dev test coverage help \
        demo-up demo-seed demo-load demo-watch demo-100 demo-down demo-urls demo-malicious clean-accounts clean-accounts-apply \
        EndtoEnd grafana-k8s-cm

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
	@echo "  Demo & load test (logic lives in loadtest/ — these delegate there):"
	@echo "  make demo-100       Local one-shot: stack -> seed -> watcher -> k6 burst"
	@echo "  make demo-down      Tear down local stack + remove session tokens"
	@echo "  make demo-malicious Demo A: malicious-code isolation (sandbox + seccomp)"
	@echo "  make clean-accounts Dry-run cleanup of demo-created accounts"
	@echo "  make -C loadtest help   Full demo menu (local + k3s prod, Demo A/B/C)"
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

grafana-k8s-cm: ## Regenerate k8s/15-grafana-dashboards.yaml from infra/grafana/dashboards/*.json
	@python3 infra/grafana/gen-k8s-dashboards-cm.py

# ── Demo & load test ────────────────────────────────────────────────────────
# All demo / load-test logic lives in loadtest/Makefile (local docker-compose
# + k3s prod, Demo A/B/C). These targets delegate so `make demo-*` keeps
# working from the repo root. Command-line vars (DEMO_FIXTURE=..., ENV=prod,
# OCT_ADMIN_PASSWORD=...) pass through to the sub-make automatically.
# Full menu: `make -C loadtest help`  ·  details: loadtest/README.md
demo-up demo-seed demo-load demo-watch demo-100 demo-down demo-urls demo-malicious clean-accounts clean-accounts-apply:
	@$(MAKE) -C loadtest $@

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
