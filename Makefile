.PHONY: help venv install migrate rbac alerts seed run run-lan frontend-install frontend-dev frontend-build frontend-check dev-check backend-check check test test-fast docker-up docker-down reset-db

PY := .venv/bin/python
PIP := .venv/bin/python -m

help:
	@echo "Learning Centre CRM"
	@echo ""
	@echo "  make install           Create .venv and install backend dependencies"
	@echo "  make migrate           Apply database migrations"
	@echo "  make rbac              Sync roles and permissions with the RBAC matrix"
	@echo "  make seed              Load realistic demo data (safe to re-run)"
	@echo "  make run               Run the Django development server on 127.0.0.1:8000"
	@echo "  make run-lan           Same, but bound to 0.0.0.0 for LAN access (do not browse to it)"
	@echo "  make test              Run the backend test suite"
	@echo "  make check             Backend system check + frontend type check"
	@echo "  make dev-check         Show whether Django :8000 and Vite :5173 are actually up"
	@echo "  make frontend-install  Install frontend dependencies"
	@echo "  make frontend-dev      Run the Vite dev server on :5173 (proxies /api) - BROWSE THIS"
	@echo "  make frontend-build    Build the SPA into frontend/dist"
	@echo "  make frontend-check    Type-check the SPA without building"
	@echo "  make docker-up         Start Postgres + app with docker compose"
	@echo "  make reset-db          Drop and recreate the local SQLite database"

venv:
	uv venv --python 3.13 .venv

install: venv
	uv pip install --python $(PY) -r backend/requirements.txt

migrate:
	cd backend && ../$(PY) manage.py migrate

rbac:
	cd backend && ../$(PY) manage.py sync_rbac

alerts:
	cd backend && ../$(PY) manage.py refresh_alerts

seed:
	cd backend && ../$(PY) manage.py seed_demo_data

run:
	cd backend && ../$(PY) manage.py runserver 127.0.0.1:8000

# Reachable from other devices on the LAN. NOTE: 0.0.0.0 is a BIND address, not a
# destination - never open http://0.0.0.0:8000 in a browser, and never add it to
# ALLOWED_HOSTS. Browse http://localhost:5173 (Vite) or http://127.0.0.1:8000.
run-lan:
	cd backend && ../$(PY) manage.py runserver 0.0.0.0:8000

backend-check:
	cd backend && ../$(PY) manage.py check
	cd backend && ../$(PY) manage.py makemigrations --check --dry-run

# Type-check the SPA without emitting. `npm run build` runs this first, so a type
# error here is exactly what silently disables `make frontend-build`.
frontend-check:
	cd frontend && npx tsc --noEmit

check: backend-check frontend-check

# Are both dev servers actually up? Run this whenever a request returns
# ECONNREFUSED - it means one of them is not running, not that something broke.
dev-check:
	@curl -sf -o /dev/null http://127.0.0.1:8000/api/health && echo 'Django  :8000 -> UP' || echo 'Django  :8000 -> DOWN   (start it: make run)'
	@curl -sf -o /dev/null http://localhost:5173/ && echo 'Vite    :5173 -> UP' || echo 'Vite    :5173 -> DOWN   (start it: make frontend-dev)'

test:
	cd backend && ../$(PY) -m pytest

test-fast:
	cd backend && ../$(PY) -m pytest -x -q

frontend-install:
	cd frontend && npm install

frontend-dev:
	cd frontend && npm run dev

frontend-build:
	cd frontend && npm run build

docker-up:
	docker compose up --build -d

docker-down:
	docker compose down

reset-db:
	rm -f backend/db.sqlite3
	cd backend && ../$(PY) manage.py migrate && ../$(PY) manage.py sync_rbac && ../$(PY) manage.py seed_demo_data
