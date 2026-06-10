SHELL := /bin/bash

# Repo root (this Makefile lives in <root>/loadtest). All docker compose calls
# use -f $(ROOT)/docker-compose.yml so they work regardless of CWD; the compose
# project is named `oct` (see docker-compose.yml `name:`), so the network stays
# `oct_default` no matter where make is invoked from.
ROOT := $(realpath $(dir $(lastword $(MAKEFILE_LIST)))/..)
COMPOSE := docker compose -f $(ROOT)/docker-compose.yml

.PHONY: help demo-up demo-seed demo-load demo-watch demo-100 demo-down demo-urls \
        demo-malicious clean-accounts clean-accounts-apply \
        _require-prod-pass _node-check _local-only

# ── Switchable target environment ───────────────────────────────────────────
# ENV=local (default) → docker-compose stack on this host
# ENV=prod            → the deployed k3s server (real KEDA autoscaling)
ENV ?= local

LOCAL_BASE_URL ?= http://localhost:3000/api
PROD_BASE_URL  ?= https://ikmlab.cs.nthu.edu.tw/online_code_test/api
PROD_ADMIN_USER ?= root
# SECURITY: never hardcode the prod password here. Provide it at call time:
#   export OCT_ADMIN_PASSWORD='...'      (or prefix the make command)
OCT_ADMIN_PASSWORD ?=

# Load parameters
DEMO_N      ?= 100
DEMO_VUS    ?= 100
DEMO_FIXTURE ?= ac.py
WORKER_REPLICAS ?= 1
INCLUDE_LOADTEST ?=

# Resolve per-ENV connection + credentials. Local seeding uses the scenario
# interviewer `alice`; prod uses the superuser `root` + OCT_ADMIN_PASSWORD.
ifeq ($(ENV),prod)
  BASE_URL := $(PROD_BASE_URL)
  SEED_USER := $(PROD_ADMIN_USER)
  SEED_PASS := $(OCT_ADMIN_PASSWORD)
  ADMIN_USER := $(PROD_ADMIN_USER)
  ADMIN_PASS := $(OCT_ADMIN_PASSWORD)
else
  BASE_URL := $(LOCAL_BASE_URL)
  SEED_USER := alice
  SEED_PASS := Test@1234
  ADMIN_USER := root
  ADMIN_PASS := Root@1234
endif

help:
	@echo "OCT demo & load-test runner"
	@echo ""
	@echo "  統一規則：不加 = 本地 docker-compose；加 ENV=prod = 打 k3s 生產 server。"
	@echo "  (ENV=prod 時須先 export OCT_ADMIN_PASSWORD='...'，並用 root 登入)"
	@echo ""
	@echo "  測試目標（皆吃 ENV=prod 開關）:"
	@echo "    make demo-malicious [ENV=prod]               Demo A：惡意程式碼隔離"
	@echo "    make demo-seed      [ENV=prod]               Demo B/C：建應試者 + 考場"
	@echo "    make demo-load      [ENV=prod]               Demo B：高並發提交 (ac.py)"
	@echo "    make demo-load      [ENV=prod] DEMO_FIXTURE=tle.py   Demo C：耗資源提交"
	@echo "    make clean-accounts        [ENV=prod] [INCLUDE_LOADTEST=1]  dry-run 清理"
	@echo "    make clean-accounts-apply  [ENV=prod] [INCLUDE_LOADTEST=1]  真的刪除"
	@echo ""
	@echo "  本地專用（生命週期；對這些下 ENV=prod 會被擋下）:"
	@echo "    make demo-up                 起 docker-compose 全套 stack"
	@echo "    make demo-100                一鍵：demo-up→seed→watcher→demo-load"
	@echo "    make demo-watch              scale-watcher.sh（本地模擬擴縮）"
	@echo "    make demo-down               收掉 stack + 清 session tokens"
	@echo ""
	@echo "    make demo-urls               印出本地 + 生產 Grafana 觀察網址"
	@echo ""
	@echo "  典型流程:"
	@echo "    本地 B：make demo-100"
	@echo "    k3s  B：make demo-seed ENV=prod && make demo-load ENV=prod"
	@echo "    （兩者測試指令只差 ENV=prod；本地多一步 demo-up 起 stack）"
	@echo ""
	@echo "  變數: ENV(local|prod) DEMO_N($(DEMO_N)) DEMO_VUS($(DEMO_VUS)) DEMO_FIXTURE($(DEMO_FIXTURE))"

# ── guards ──────────────────────────────────────────────────────────────────
_require-prod-pass:
	@if [ "$(ENV)" = "prod" ] && [ -z "$(OCT_ADMIN_PASSWORD)" ]; then \
	  echo "ERROR: ENV=prod 需要密碼。請先： export OCT_ADMIN_PASSWORD='...'  (或在指令前加 OCT_ADMIN_PASSWORD=...)" >&2; \
	  exit 1; \
	fi

_node-check:
	@v=$$(node -e 'console.log(parseInt(process.versions.node.split(".")[0]))' 2>/dev/null); \
	  if [ -z "$$v" ] || [ "$$v" -lt 16 ]; then \
	    echo "ERROR: 需要 Node 16+ (tsx)。實際: $$(node --version 2>/dev/null || echo none)。先執行 'nvm use'。" >&2; \
	    exit 1; \
	  fi

# 本地專用目標的護欄：k3s 已部署且由 KEDA 自動擴縮，不該對它 up/down/watch。
# 統一規則：加 ENV=prod = 打 k3s（只用 demo-seed / demo-load / demo-malicious /
# clean-accounts*）；不加 = 本地。誤把 ENV=prod 用在本地生命週期目標時直接擋下。
_local-only:
	@if [ "$(ENV)" = "prod" ]; then \
	  echo "ERROR: '$(MAKECMDGOALS)' 是本地專用目標。k3s 已部署、由 KEDA 自動擴縮，" >&2; \
	  echo "       不需要 up/watch/down。請改用： make demo-seed ENV=prod / make demo-load ENV=prod" >&2; \
	  exit 1; \
	fi

# ── Demo A: malicious code isolation ─────────────────────────────────────────
demo-malicious: _node-check _require-prod-pass
	cd $(ROOT)/loadtest && BASE_URL=$(BASE_URL) \
	  INTERVIEWER_USERNAME=$(SEED_USER) INTERVIEWER_PASSWORD='$(SEED_PASS)' \
	  npx --yes tsx demo-malicious.ts

clean-accounts: _node-check _require-prod-pass
	cd $(ROOT)/loadtest && BASE_URL=$(BASE_URL) \
	  ADMIN_USERNAME=$(ADMIN_USER) ADMIN_PASSWORD='$(ADMIN_PASS)' \
	  npx --yes tsx demo-cleanup.ts $(if $(INCLUDE_LOADTEST),--include-loadtest,)

clean-accounts-apply: _node-check _require-prod-pass
	cd $(ROOT)/loadtest && BASE_URL=$(BASE_URL) \
	  ADMIN_USERNAME=$(ADMIN_USER) ADMIN_PASSWORD='$(ADMIN_PASS)' \
	  npx --yes tsx demo-cleanup.ts --confirm $(if $(INCLUDE_LOADTEST),--include-loadtest,)

# ── Demo B/C: load test ──────────────────────────────────────────────────────
# Local brings up the compose stack; prod targets the already-deployed k3s and
# relies on its real KEDA ScaledObject (no scale-watcher needed).
demo-up: _local-only
	$(MAKE) -C $(ROOT) bootstrap isolate-rootfs
	WORKER_REPLICAS=$(WORKER_REPLICAS) $(COMPOSE) up -d --build --wait --scale worker=$(WORKER_REPLICAS)

demo-seed: _node-check _require-prod-pass
	cd $(ROOT)/loadtest && N=$(DEMO_N) BASE_URL=$(BASE_URL) \
	  INTERVIEWER_USERNAME=$(SEED_USER) INTERVIEWER_PASSWORD='$(SEED_PASS)' \
	  npx --yes tsx seed.ts

demo-load:
	@if [ "$(ENV)" = "prod" ]; then \
	  echo "[demo-load] ENV=prod → $(PROD_BASE_URL)  VUS=$(DEMO_VUS) FIXTURE=$(DEMO_FIXTURE)"; \
	  docker run --rm -v $(ROOT)/loadtest:/scripts \
	    -e BASE_URL=$(PROD_BASE_URL) -e VUS=$(DEMO_VUS) -e FIXTURE=$(DEMO_FIXTURE) \
	    grafana/k6 run /scripts/k6-submit.js; \
	else \
	  echo "[demo-load] ENV=local → in-cluster backend  VUS=$(DEMO_VUS) FIXTURE=$(DEMO_FIXTURE)"; \
	  docker run --rm --network oct_default -v $(ROOT)/loadtest:/scripts \
	    -e BASE_URL=http://backend:3000/api -e VUS=$(DEMO_VUS) -e FIXTURE=$(DEMO_FIXTURE) \
	    grafana/k6 run /scripts/k6-submit.js; \
	fi

demo-watch: _local-only
	$(ROOT)/loadtest/scale-watcher.sh

demo-100: _local-only demo-up
	@echo "[demo-100] worker replicas: $(WORKER_REPLICAS) (scale-watcher fans out to MAX=5)"
	@$(MAKE) -f $(ROOT)/loadtest/Makefile demo-seed
	@echo "[demo-100] starting scale-watcher in background (logs -> /tmp/oct-scale-watcher.log)"
	@nohup $(ROOT)/loadtest/scale-watcher.sh > /tmp/oct-scale-watcher.log 2>&1 &
	@sleep 3
	@$(MAKE) -f $(ROOT)/loadtest/Makefile demo-load
	@echo
	@$(MAKE) -f $(ROOT)/loadtest/Makefile demo-urls
	@echo "[demo-100] watcher still running; 'pkill -f scale-watcher.sh' to stop."

demo-down: _local-only
	$(COMPOSE) down -v
	rm -f $(ROOT)/loadtest/.session-tokens.json
	-pkill -f scale-watcher.sh 2>/dev/null || true

demo-urls:
	@echo "── 本地 (docker-compose) ──"
	@echo "Grafana   : http://localhost:$${HOST_GRAFANA_PORT:-3001}  (admin/oct_dev_grafana)"
	@echo "  red     : http://localhost:$${HOST_GRAFANA_PORT:-3001}/d/oct-api-red"
	@echo "  judge   : http://localhost:$${HOST_GRAFANA_PORT:-3001}/d/oct-judge-pipeline"
	@echo "  lb      : http://localhost:$${HOST_GRAFANA_PORT:-3001}/d/oct-lb-resilience"
	@echo "RabbitMQ  : http://localhost:$${HOST_RABBITMQ_MGMT_PORT:-15672}  (oct / oct_dev_password)"
	@echo "── 生產 k3s ──"
	@echo "Grafana   : https://ikmlab.cs.nthu.edu.tw/online_code_test/grafana/"
	@echo "  red     : .../grafana/d/oct-api-red          (系統健不健康)"
	@echo "  judge   : .../grafana/d/oct-judge-pipeline   (佇列深度 + KEDA worker 擴縮)"
	@echo "  lb      : .../grafana/d/oct-lb-resilience    (跨節點負載分布)"
