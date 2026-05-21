SHELL := /bin/bash

.PHONY: install test test-integration test-integration-isolate test-all clean \
        build-language-images build-isolate-rootfs clean-isolate-rootfs \
        verify-language list-languages \
        build-sandbox-images build-sandbox-cpp build-sandbox-python

# Where the host stores the extracted language rootfs trees that the local
# Isolate engine chroots into. Mirrors the K8s hostPath layout.
HOST_ROOTFS_DIR ?= /tmp/oct-rootfs

# Picks Node from PATH; for users on NVM, the parent shell needs to have a
# usable Node 20+ in PATH or override:
#   make verify-language LANG=cpp17 NODE_BIN=/home/me/.nvm/versions/node/v20.20.2/bin/node
NODE_BIN ?= node

# Helper: emit "<id>\t<image>\t<dockerfileContext>" lines for enabled langs.
LIST_LANGUAGES_CMD := $(NODE_BIN) scripts/list-languages.mjs --enabled-only

install:
	npm install

# --- Language environment images -------------------------------------------
# Build OCI image for every enabled language declared in languages.yaml.
# Convention: worker/sandbox/<id>/Dockerfile (override via spec.dockerfileContext).

build-language-images:
	@$(LIST_LANGUAGES_CMD) | while IFS=$$'\t' read -r id image ctx; do \
	  echo "→ building $$id ($$image) from sandbox/$$ctx/Dockerfile"; \
	  docker build -t "$$image" "sandbox/$$ctx" || exit 1; \
	done

# Legacy aliases retained for the root Makefile / CI workflow / README that
# still reference `build-sandbox-images`. Both call the data-driven target.
build-sandbox-images: build-language-images
build-sandbox-cpp:    build-language-images
build-sandbox-python: build-language-images

list-languages:
	@$(LIST_LANGUAGES_CMD)

# --- Isolate engine rootfs (local dev / integration testing) ---------------
# Extracts every enabled language's image into a flat rootfs at
# $(HOST_ROOTFS_DIR)/<id>/. Mirrors what the language-rootfs-puller DaemonSet
# does in K8s (skopeo + umoci), but uses docker create + docker export so it
# works offline without a registry.

build-isolate-rootfs: build-language-images
	@mkdir -p $(HOST_ROOTFS_DIR)
	@$(LIST_LANGUAGES_CMD) | while IFS=$$'\t' read -r id image ctx; do \
	  echo "→ extracting $$image into $(HOST_ROOTFS_DIR)/$$id"; \
	  cid=$$(docker create $$image /bin/true); \
	  rm -rf "$(HOST_ROOTFS_DIR)/$$id"; \
	  mkdir -p "$(HOST_ROOTFS_DIR)/$$id"; \
	  docker export "$$cid" | tar -x -C "$(HOST_ROOTFS_DIR)/$$id" 2>/dev/null || true; \
	  docker rm "$$cid" >/dev/null; \
	done
	@echo "isolate rootfs ready under $(HOST_ROOTFS_DIR)"

clean-isolate-rootfs:
	-rm -rf $(HOST_ROOTFS_DIR)

# --- New-language smoke verification ---------------------------------------
# Builds the language image, extracts its rootfs, spins a one-shot worker
# container, and runs scripts/verify-language.mjs which compiles + runs the
# language's `sandbox/<id>/smoke/<source>` through IsolateEngine and asserts
# stdout matches `sandbox/<id>/smoke/expected.txt`.
#
# This is the PRE-PUSH gate when adding a new language. Exits non-zero on
# any verdict / output mismatch.
#
# Usage:
#   make verify-language LANG=cpp17
#   make verify-language LANG=python3

verify-language: build-isolate-rootfs
	@test -n "$(LANG)" || { echo "Usage: make verify-language LANG=<id>"; exit 1; }
	@docker build -t oct-worker:test . >/dev/null
	@docker run --rm --privileged --cgroupns=host \
	  -e SECCOMP_BUNDLE_DIR=/etc/oct \
	  -e VERIFY_LANG=$(LANG) \
	  -v $(HOST_ROOTFS_DIR):/var/lib/oct/rootfs:ro \
	  -v $(PWD)/sandbox/languages.yaml:/app/sandbox/languages.yaml:ro \
	  -v $(PWD)/sandbox:/host-sandbox:ro \
	  -v $(PWD)/scripts/verify-language.mjs:/verify.mjs:ro \
	  oct-worker:test \
	  sh -c "mkdir -p /tmp/judge && node /verify.mjs"

# --- Tests -----------------------------------------------------------------

test:
	npm test

test-integration: build-language-images
	npm run test:integration

# Runs the 12-case Isolate engine e2e (4 verdict + 7 security + 1 seccomp)
# inside a one-shot worker container. The pre-push regression suite.
test-integration-isolate: build-isolate-rootfs
	docker build -t oct-worker:test .
	docker run --rm --privileged --cgroupns=host \
	  -e SECCOMP_BUNDLE_DIR=/etc/oct \
	  -v $(HOST_ROOTFS_DIR):/var/lib/oct/rootfs:ro \
	  -v $(PWD)/scripts/isolate-e2e.mjs:/e2e.mjs:ro \
	  oct-worker:test \
	  sh -c "mkdir -p /tmp/judge && node /e2e.mjs"

test-all: build-language-images
	npm run test:all

clean:
	@$(LIST_LANGUAGES_CMD) | awk -F'\t' '{print $$2}' | xargs -r docker rmi 2>/dev/null || true
	$(MAKE) clean-isolate-rootfs
