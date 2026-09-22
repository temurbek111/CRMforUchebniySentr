.PHONY: help venv install migrate rbac seed run test test-fast frontend-install frontend-dev frontend-build docker-up docker-down reset-db check

PY := .venv/bin/python
PIP := .venv/bin/python -m

help:
	@echo "Learning Centre CRM"
	@echo ""
	@echo "  make install           Create .venv and install backend dependencies"
	@echo "  make migrate           Apply database migrations"
	@echo "  make rbac              Sync roles and permissions with the RBAC matrix"
	@echo "  make seed              Load realistic demo data (safe to re-run)"
	@echo "  make run               Run the Django development server on :8000"
	@echo "  make test              Run the backend test suite"
	@echo "  make frontend-install  Install frontend dependencies"
	@echo "  make frontend-dev      Run the Vite dev server on :5173 (proxies /api)"
	@echo "  make frontend-build    Build the SPA into frontend/dist"
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
	cd backend && ../$(PY) manage.py runserver 0.0.0.0:8000

check:
	cd backend && ../$(PY) manage.py check
	cd backend && ../$(PY) manage.py makemigrations --check --dry-run

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
