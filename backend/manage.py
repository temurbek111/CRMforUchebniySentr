#!/usr/bin/env python
"""Django management entrypoint for the Learning Centre CRM."""
import os
import sys


def main() -> None:
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:  # pragma: no cover - environment guard
        raise ImportError(
            "Django is not importable. Activate the project virtualenv "
            "(source .venv/bin/activate) or run via .venv/bin/python."
        ) from exc
    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
