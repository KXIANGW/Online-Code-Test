SHELL := /bin/bash

.PHONY: build-sandbox-images build-sandbox-cpp build-sandbox-python \
        install test test-integration test-integration-isolate \
        build-isolate-rootfs clean-isolate-rootfs clean

# Where the host stores the extracted language rootfs trees that the local
# Isolate engine chroots into. Mirrors the K8s hostPath layout.
HOST_ROOTFS_DIR ?= /tmp/oct-rootfs

install:
	npm install

# --- Docker engine sandbox images ------------------------------------------

build-sandbox-images: build-sandbox-cpp build-sandbox-python

build-sandbox-cpp:
	docker build -t oct-sandbox-cpp:12 sandbox/cpp

build-sandbox-python:
	docker build -t oct-sandbox-python:3.11 sandbox/python

# --- Isolate engine rootfs (local dev / integration testing) ---------------
# Extracts the rootfs of the same Docker sandbox images into a flat directory
# tree at $(HOST_ROOTFS_DIR)/<lang>/, mirroring what the language-rootfs-puller
# DaemonSet does in K8s (skopeo + umoci).
#
# This lets `SANDBOX_ENGINE=isolate docker compose up worker` work without
# needing a real OCI registry or installing skopeo/umoci on the host.

build-isolate-rootfs: build-sandbox-images
	@mkdir -p $(HOST_ROOTFS_DIR)
	@set -e; \
	extract_one() { \
	  local image="$$1"; local lang="$$2"; \
	  echo "→ extracting $$image into $(HOST_ROOTFS_DIR)/$$lang"; \
	  local cid; cid="$$(docker create $$image /bin/true)"; \
	  rm -rf "$(HOST_ROOTFS_DIR)/$$lang"; \
	  mkdir -p "$(HOST_ROOTFS_DIR)/$$lang"; \
	  docker export "$$cid" | tar -x -C "$(HOST_ROOTFS_DIR)/$$lang" 2>/dev/null || true; \
	  docker rm "$$cid" >/dev/null; \
	}; \
	extract_one oct-sandbox-cpp:12       cpp17; \
	extract_one oct-sandbox-python:3.11  python3
	@echo "isolate rootfs ready under $(HOST_ROOTFS_DIR)"

clean-isolate-rootfs:
	-rm -rf $(HOST_ROOTFS_DIR)

# --- Tests -----------------------------------------------------------------

test:
	npm test

test-integration: build-sandbox-images
	npm run test:integration

# Run the IsolateEngine E2E inside the worker container (which has the
# isolate binary baked in). Spins up a one-shot docker run with the host's
# cgroup namespace and the extracted rootfs mounted; exits non-zero if any
# case fails. Designed for `make test-integration-isolate` to be the local
# counterpart of running Phase 4 K8s integration tests.
test-integration-isolate: build-isolate-rootfs
	docker build -t oct-worker:test .
	docker run --rm --privileged --cgroupns=host \
	  -e SECCOMP_BUNDLE_DIR=/etc/oct \
	  -v $(HOST_ROOTFS_DIR):/var/lib/oct/rootfs:ro \
	  -v $(PWD)/scripts/isolate-e2e.mjs:/e2e.mjs:ro \
	  oct-worker:test \
	  sh -c "mkdir -p /tmp/judge && node /e2e.mjs"

test-all: build-sandbox-images
	npm run test:all

clean:
	-docker rmi oct-sandbox-cpp:12 oct-sandbox-python:3.11 2>/dev/null || true
	$(MAKE) clean-isolate-rootfs
