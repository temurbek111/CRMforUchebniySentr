"""Serve the built single-page application, or explain how to build it."""

from __future__ import annotations

from django.conf import settings
from django.http import HttpRequest, HttpResponse, JsonResponse

_BUILD_HINT = (
    "The frontend bundle was not found at frontend/dist. Either run the Vite dev "
    "server (`cd frontend && npm run dev`, which proxies /api to this server) or "
    "build it with `cd frontend && npm run build`."
)


def spa_index(request: HttpRequest, *args, **kwargs) -> HttpResponse:
    index = settings.FRONTEND_DIST / "index.html"
    if not index.exists():
        return JsonResponse({"detail": _BUILD_HINT}, status=503)
    return HttpResponse(index.read_text(encoding="utf-8"), content_type="text/html")
