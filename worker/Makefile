SHELL := /bin/bash

.PHONY: build-sandbox-images build-sandbox-cpp build-sandbox-python \
        install test test-integration clean

install:
	npm install

build-sandbox-images: build-sandbox-cpp build-sandbox-python

build-sandbox-cpp:
	docker build -t oct-sandbox-cpp:12 sandbox/cpp

build-sandbox-python:
	docker build -t oct-sandbox-python:3.11 sandbox/python

test:
	npm test

test-integration: build-sandbox-images
	npm run test:integration

test-all: build-sandbox-images
	npm run test:all

clean:
	-docker rmi oct-sandbox-cpp:12 oct-sandbox-python:3.11 2>/dev/null || true
