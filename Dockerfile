# syntax=docker/dockerfile:1
#
# Learning Centre CRM - production image.
#
# Three stages:
#   frontend  - builds the React/TypeScript SPA into /app/frontend/dist
#   backend   - installs the pinned Python dependencies into a venv
#   runtime   - slim image with only the runtime OS libraries, both build
#               artifacts, and a non-root user
#
# The image runs migrations, syncs RBAC, collects static files and then starts
# Gunicorn. Migrations are idempotent, so restarting the container is safe.

# --------------------------------------------------------------------------- #
# Stage 1 - frontend build
# --------------------------------------------------------------------------- #
FROM node:20-slim AS frontend

WORKDIR /app/frontend

# Copy manifests first so the dependency layer is cached until they change.
COPY frontend/package.json frontend/package-lock.json ./
# `npm ci` installs exactly the lockfile - reproducible, unlike `npm install`.
RUN npm ci

COPY frontend ./
# Vite emits /static/assets/... (see vite.config.ts) so WhiteNoise serves the
# bundle from STATIC_ROOT. A build that emits /assets/... would return HTML
# where the browser expects JavaScript and the app would never boot.
RUN npm run build


# --------------------------------------------------------------------------- #
# Stage 2 - python dependencies
# --------------------------------------------------------------------------- #
FROM python:3.13-slim AS backend

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Build-only toolchain. These packages are NOT carried into the runtime stage.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential libpq-dev libjpeg62-turbo-dev zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

# Install into a self-contained virtualenv so the runtime stage can copy one
# directory instead of reaching into the interpreter's site-packages.
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --upgrade pip && pip install -r /tmp/requirements.txt


# --------------------------------------------------------------------------- #
# Stage 3 - runtime
# --------------------------------------------------------------------------- #
FROM python:3.13-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    DJANGO_SETTINGS_MODULE=config.settings

# Runtime SharedObject dependencies only - no compilers, no *-dev headers.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libpq5 libjpeg62-turbo zlib1g curl \
    && rm -rf /var/lib/apt/lists/*

# Unprivileged account. The application never needs root at runtime.
RUN groupadd --system --gid 1001 app \
    && useradd --system --uid 1001 --gid app --create-home app

COPY --from=backend /opt/venv /opt/venv
COPY --chown=app:app backend /app/backend
COPY --from=frontend --chown=app:app /app/frontend/dist /app/frontend/dist

WORKDIR /app/backend

# Persistent upload locations. Both are declared as volumes in
# docker-compose.yml so uploaded files survive container replacement.
RUN mkdir -p /app/media /app/staticfiles && chown -R app:app /app/media /app/staticfiles

COPY --chown=app:app docker/entrypoint.sh /app/docker/entrypoint.sh
RUN chmod +x /app/docker/entrypoint.sh

USER app

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=10s --start-period=40s --retries=5 \
    CMD curl -fsS http://127.0.0.1:8000/api/health || exit 1

ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["gunicorn", "config.wsgi:application", \
     "--bind", "0.0.0.0:8000", \
     "--workers", "3", \
     "--timeout", "60", \
     "--access-logfile", "-", \
     "--error-logfile", "-"]
