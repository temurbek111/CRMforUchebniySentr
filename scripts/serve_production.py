#!/usr/bin/env python3
"""Start the production server (Gunicorn, Postgres, DEBUG=false) for live validation."""
from __future__ import annotations

import os
import secrets
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "backend"))
os.chdir(REPO / "backend")

os.environ.update({
    "DATABASE_URL": "postgres://temurbek@127.0.0.1:5432/crm_validation",
    "DJANGO_DEBUG": "false",
    "DJANGO_ALLOWED_HOSTS": "localhost,127.0.0.1",
    "DJANGO_SECRET_KEY": secrets.token_urlsafe(64),
    "DJANGO_SETTINGS_MODULE": "config.settings",
})

from gunicorn.app.base import BaseApplication  # noqa: E402


class App(BaseApplication):
    def load_config(self):
        self.cfg.set("bind", "127.0.0.1:8010")
        self.cfg.set("workers", "2")
        self.cfg.set("timeout", "60")
        self.cfg.set("accesslog", "-")
        self.cfg.set("errorlog", "-")
        self.cfg.set("loglevel", "info")

    def load(self):
        from config.wsgi import application
        return application


if __name__ == "__main__":
    print("Starting Gunicorn on 127.0.0.1:8010 (DEBUG=false, PostgreSQL)", flush=True)
    App().run()
