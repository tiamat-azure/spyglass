# Spyglass - thin entry points over the pnpm scripts.
#
# This Makefile never duplicates build logic: every target delegates to a
# `package.json` script, which stays the single source of truth. It exists to
# give a stable, memorable surface (test / start / status / log) and to add the
# process supervision that pnpm does not provide (detached run, pidfile, logs).
#
# Run `make` or `make help` for the target list.

SHELL := /bin/bash
.DEFAULT_GOAL := help

PNPM ?= pnpm

# Runtime state, git-ignored. RUN_DIR holds the pidfile of the app started by
# `make start`; LOG_DIR holds one timestamped log per run plus a `current.log`
# symlink that `make log` follows.
STATE_DIR := .spyglass
RUN_DIR   := $(STATE_DIR)/run
LOG_DIR   := $(STATE_DIR)/logs
PID_FILE  := $(RUN_DIR)/app.pid
CUR_LOG   := $(LOG_DIR)/current.log

# `make log N=200` prints the last 200 lines instead of following the file.
N ?=

# Written by the main process at startup (see SPYGLASS_CDP_INFO); read by
# `make status` to report the live CDP endpoint. userData differs between an
# unpackaged run (`@spyglass/app`, the package name) and a packaged one
# (`Spyglass`, the electron-builder productName), so both are probed and the
# most recently written file wins. Override with SPYGLASS_CDP_INFO.
define CDP_CANDIDATES
$(HOME)/.config/@spyglass/app/cdp.json
$(HOME)/.config/Spyglass/cdp.json
$(HOME)/Library/Application Support/Spyglass/cdp.json
$(HOME)/AppData/Roaming/Spyglass/cdp.json
endef
export CDP_CANDIDATES

# Seconds to wait for a graceful SIGTERM before escalating to SIGKILL.
STOP_TIMEOUT := 5

.PHONY: help install check test-unit test-e2e test start stop restart status log package clean

help: ## Show this help
	@echo "Spyglass - make targets"
	@echo
	@grep -E '^[a-z0-9-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'
	@echo
	@echo "  make log N=200   print the last 200 lines instead of following"

install: ## Activate pnpm, install the workspace, run the preflight
	corepack enable
	corepack prepare pnpm@10.33.3 --activate
	$(PNPM) install
	$(PNPM) doctor

check: ## Static quality gate: Biome + TypeScript
	$(PNPM) lint
	$(PNPM) typecheck

test-unit: ## Unit tests, schema corpus and blocking coverage thresholds
	$(PNPM) test
	$(PNPM) test:schemas
	$(PNPM) test:coverage

test-e2e: ## Playwright end-to-end smoke against the built Electron app
	$(PNPM) test:e2e

test: check test-unit test-e2e ## Full validation: check + unit + e2e (stops on first failure)
	@echo "OK - check, unit and e2e passed"

start: ## Build and launch the app detached, capturing its output
	@if [ -f "$(PID_FILE)" ] && kill -0 "$$(cat $(PID_FILE))" 2>/dev/null; then \
		echo "already running (pid $$(cat $(PID_FILE))) - use 'make restart'"; \
		exit 1; \
	fi
	@mkdir -p "$(RUN_DIR)" "$(LOG_DIR)"
	@log="$(LOG_DIR)/app-$$(date +%Y%m%d-%H%M%S).log"; \
	ln -sfn "$$(basename "$$log")" "$(CUR_LOG)"; \
	setsid $(PNPM) start >"$$log" 2>&1 < /dev/null & \
	echo $$! > "$(PID_FILE)"; \
	echo "started (pid $$(cat $(PID_FILE))) - log: $$log"; \
	echo "'pnpm start' runs doctor then electron-vite preview, which rebuilds before launching."

stop: ## Stop the app started by `make start`
	@if [ ! -f "$(PID_FILE)" ]; then \
		echo "not running (no pidfile)"; exit 0; \
	fi; \
	pid="$$(cat $(PID_FILE))"; \
	if ! kill -0 "$$pid" 2>/dev/null; then \
		echo "not running (stale pidfile, removed)"; rm -f "$(PID_FILE)"; exit 0; \
	fi; \
	kill -TERM -"$$pid" 2>/dev/null || kill -TERM "$$pid" 2>/dev/null || true; \
	for i in $$(seq 1 $(STOP_TIMEOUT)); do \
		kill -0 "$$pid" 2>/dev/null || break; \
		sleep 1; \
	done; \
	if kill -0 "$$pid" 2>/dev/null; then \
		echo "SIGTERM ignored after $(STOP_TIMEOUT)s, sending SIGKILL"; \
		kill -KILL -"$$pid" 2>/dev/null || kill -KILL "$$pid" 2>/dev/null || true; \
	fi; \
	rm -f "$(PID_FILE)"; \
	echo "stopped (pid $$pid)"

restart: ## Stop then start again
	@$(MAKE) --no-print-directory stop
	@$(MAKE) --no-print-directory start

status: ## Report process, CDP endpoint, log and build artefacts
	@if [ -f "$(PID_FILE)" ] && kill -0 "$$(cat $(PID_FILE))" 2>/dev/null; then \
		echo "app       running (pid $$(cat $(PID_FILE)))"; \
	elif [ -f "$(PID_FILE)" ]; then \
		echo "app       stopped (stale pidfile: $(PID_FILE))"; \
	else \
		echo "app       stopped"; \
	fi
	@info="$(SPYGLASS_CDP_INFO)"; \
	[ -n "$$info" ] && [ -f "$$info" ] || info=""; \
	[ -z "$$info" ] && while IFS= read -r candidate; do \
		[ -n "$$candidate" ] && [ -f "$$candidate" ] || continue; \
		if [ -z "$$info" ] || [ "$$candidate" -nt "$$info" ]; then info="$$candidate"; fi; \
	done <<< "$$CDP_CANDIDATES"; \
	if [ -n "$$info" ]; then \
		if [ -f "$(PID_FILE)" ] && kill -0 "$$(cat $(PID_FILE))" 2>/dev/null; then state=""; else state=" [stale, app stopped]"; fi; \
		echo "cdp       $$(node -e 'const i=require(process.argv[1]);console.log(i.cdpUrl ?? i.port ?? JSON.stringify(i))' "$$info" 2>/dev/null || echo "unreadable")$$state  ($$info)"; \
	else \
		echo "cdp       no cdp.json found (app never started, or CDP disabled)"; \
	fi
	@if [ -e "$(CUR_LOG)" ]; then \
		echo "log       $$(readlink -f "$(CUR_LOG)") ($$(wc -l < "$(CUR_LOG)" 2>/dev/null || echo 0) lines)"; \
	else \
		echo "log       none"; \
	fi
	@if [ -d packages/app/out ]; then echo "build     packages/app/out present"; else echo "build     packages/app/out absent"; fi
	@if [ -d packages/app/release ]; then echo "package   packages/app/release present"; else echo "package   packages/app/release absent"; fi

log: ## Follow the current run log (make log N=200 for a plain tail)
	@if [ ! -e "$(CUR_LOG)" ]; then echo "no log yet - run 'make start' first"; exit 1; fi
	@if [ -n "$(N)" ]; then tail -n "$(N)" "$(CUR_LOG)"; else tail -f -n 50 "$(CUR_LOG)"; fi

package: ## Build the unsigned installer for the current OS
	$(PNPM) package

clean: ## Remove build outputs, coverage and runtime state
	rm -rf packages/app/out packages/app/release coverage $(STATE_DIR)
