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
MATCH_FILE := $(RUN_DIR)/app.match
CUR_LOG   := $(LOG_DIR)/current.log

# argv fragment of the unpackaged Electron binary launched by `make start`.
DEV_MATCH := electron/dist/electron

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

# Picks the freshest readable cdp.json into `$$info` (empty when none exists).
# Shared verbatim by `start` (readiness probe) and `status` (reporting), so the
# two can never disagree on which endpoint file they are talking about.
define FIND_CDP_INFO
info="$(SPYGLASS_CDP_INFO)"; \
	{ [ -n "$$info" ] && [ -f "$$info" ]; } || info=""; \
	if [ -z "$$info" ]; then \
		while IFS= read -r candidate; do \
			{ [ -n "$$candidate" ] && [ -f "$$candidate" ]; } || continue; \
			if [ -z "$$info" ] || [ "$$candidate" -nt "$$info" ]; then info="$$candidate"; fi; \
		done <<< "$$CDP_CANDIDATES"; \
	fi
endef

# Prints the pids of the Electron processes belonging to `$$pid`'s process
# group. `setsid` in the launcher makes that group id equal to the launcher pid,
# so this tells an app that is genuinely up from a launcher that is still
# building or that died leaving nothing behind. `$$match` is the argv fragment
# identifying the real process: the dev Electron binary for `make start`, the
# packaged binary for `make run`.
define ELECTRON_PIDS
ps -eo pgid=,pid=,args= 2>/dev/null \
		| awk -v g="$$pid" -v m="$$match" '$$1 == g && index($$0, m) > 0 { print $$2 }'
endef

# Reads back the argv fragment written by the last launch, so `status` probes
# the same processes the launcher waited for. Defaults to the dev binary.
define LOAD_MATCH
match="$$(cat "$(MATCH_FILE)" 2>/dev/null)"; \
	[ -n "$$match" ] || match="$(DEV_MATCH)"
endef

# Packaged binary produced by `make package`, per platform. The first existing
# candidate wins; override with SPYGLASS_BIN for another target or arch.
define APP_BIN_CANDIDATES
packages/app/release/linux-unpacked/spyglass
packages/app/release/mac-arm64/Spyglass.app/Contents/MacOS/spyglass
packages/app/release/mac/Spyglass.app/Contents/MacOS/spyglass
packages/app/release/win-unpacked/spyglass.exe
endef
export APP_BIN_CANDIDATES

# Picks the packaged binary into `$$bin` (empty when nothing is packaged yet).
define FIND_APP_BIN
bin="$(SPYGLASS_BIN)"; \
	{ [ -n "$$bin" ] && [ -x "$$bin" ]; } || bin=""; \
	if [ -z "$$bin" ]; then \
		while IFS= read -r candidate; do \
			{ [ -n "$$candidate" ] && [ -x "$$candidate" ]; } || continue; \
			bin="$$candidate"; break; \
		done <<< "$$APP_BIN_CANDIDATES"; \
	fi
endef

# Seconds to wait for a graceful SIGTERM before escalating to SIGKILL.
STOP_TIMEOUT := 5

# Seconds `make start` waits for Electron to spawn (the build runs first, so
# this is generous) and then for it to report a live CDP endpoint.
START_TIMEOUT ?= 120
READY_TIMEOUT ?= 45

.PHONY: help install check test-unit test-e2e test start run launch stop restart status log package clean

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

start: ## Build and launch the dev app detached, then wait until it is really up
	@$(MAKE) --no-print-directory launch \
		LAUNCH_CMD="$(PNPM) start" \
		LAUNCH_MATCH="$(DEV_MATCH)" \
		LAUNCH_NOTE="'pnpm start' runs doctor then electron-vite preview, which rebuilds before launching."

run: ## Launch the packaged binary built by `make package` (same supervision as start)
	@$(FIND_APP_BIN); \
	if [ -z "$$bin" ]; then \
		echo "no packaged binary found - run 'make package' first (or set SPYGLASS_BIN)"; \
		exit 1; \
	fi; \
	args=""; \
	sandbox="$$(dirname "$$bin")/chrome-sandbox"; \
	if [ "$$(uname -s)" = "Linux" ] && [ -f "$$sandbox" ] && [ ! -u "$$sandbox" ]; then \
		echo "note: $$sandbox is not setuid root, launching with --no-sandbox."; \
		echo "      Install the .deb instead for a sandboxed run (see README)."; \
		args="--no-sandbox --no-zygote"; \
	fi; \
	$(MAKE) --no-print-directory launch \
		LAUNCH_CMD="$$bin $$args" \
		LAUNCH_MATCH="$$bin" \
		LAUNCH_NOTE="packaged binary: $$bin"

# Internal: shared supervised launcher behind `start` and `run`. Not meant to be
# called directly; LAUNCH_CMD is the command to detach, LAUNCH_MATCH the argv
# fragment that identifies the resulting Electron process.
launch:
	@if [ -f "$(PID_FILE)" ] && kill -0 "$$(cat $(PID_FILE))" 2>/dev/null; then \
		echo "already running (pid $$(cat $(PID_FILE))) - use 'make restart'"; \
		exit 1; \
	fi
	@mkdir -p "$(RUN_DIR)" "$(LOG_DIR)"
	@log="$(LOG_DIR)/app-$$(date +%Y%m%d-%H%M%S).log"; \
	ln -sfn "$$(basename "$$log")" "$(CUR_LOG)"; \
	touch "$(RUN_DIR)/started.at"; \
	match="$(LAUNCH_MATCH)"; \
	echo "$$match" > "$(MATCH_FILE)"; \
	setsid $(LAUNCH_CMD) >"$$log" 2>&1 < /dev/null & \
	pid=$$!; \
	echo "$$pid" > "$(PID_FILE)"; \
	echo "launching (pid $$pid) - log: $$log"; \
	[ -z "$(LAUNCH_NOTE)" ] || echo "$(LAUNCH_NOTE)"; \
	fail() { \
		echo; \
		echo "FAILED - $$1"; \
		echo; \
		tail -n 15 "$$log" | sed 's/^/    /'; \
		echo; \
		echo "full log: $$log"; \
		rm -f "$(PID_FILE)"; \
		exit 1; \
	}; \
	spawned=""; \
	for _ in $$(seq 1 $(START_TIMEOUT)); do \
		kill -0 "$$pid" 2>/dev/null || fail "the launcher exited before Electron started."; \
		spawned="$$($(ELECTRON_PIDS) | head -1)"; \
		[ -n "$$spawned" ] && break; \
		sleep 1; \
	done; \
	[ -n "$$spawned" ] || fail "Electron did not start within $(START_TIMEOUT)s."; \
	for _ in $$(seq 1 $(READY_TIMEOUT)); do \
		kill -0 "$$pid" 2>/dev/null || fail "Electron started then died during startup."; \
		$(FIND_CDP_INFO); \
		if [ -n "$$info" ] && [ "$$info" -nt "$(RUN_DIR)/started.at" ]; then \
			echo "ready (pid $$pid) - window shown, cdp $$(node -e 'const i=require(process.argv[1]);console.log(i.cdpUrl ?? i.port ?? "")' "$$info" 2>/dev/null)"; \
			exit 0; \
		fi; \
		sleep 1; \
	done; \
	echo; \
	echo "WARNING - Electron is running (pid $$pid) but never reported a CDP endpoint."; \
	echo "The window may not be visible. This is expected only when CDP is disabled."; \
	echo "Check 'make log'."


stop: ## Stop the app started by `make start` or `make run`
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
		pid="$$(cat $(PID_FILE))"; \
		$(LOAD_MATCH); \
		count="$$($(ELECTRON_PIDS) | wc -l | tr -d ' ')"; \
		if [ "$$count" -gt 0 ]; then \
			echo "app       running (launcher pid $$pid, $$count electron processes)"; \
		else \
			echo "app       launcher pid $$pid alive but no electron process - still building, or startup failed (see 'make log')"; \
		fi; \
	elif [ -f "$(PID_FILE)" ]; then \
		echo "app       stopped (stale pidfile: $(PID_FILE))"; \
	else \
		echo "app       stopped"; \
	fi
	@$(FIND_CDP_INFO); \
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
