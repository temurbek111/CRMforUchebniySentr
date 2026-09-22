"""URL configuration: API first, SPA fallback last."""

from __future__ import annotations

from django.conf import settings
from django.contrib import admin
from django.urls import include, path, re_path

from .views import spa_index

api_patterns = [
    path("auth/", include("apps.accounts.urls_auth")),
    path("", include("apps.accounts.urls")),
    path("", include("apps.core.urls")),
    path("", include("apps.academics.urls")),
    path("", include("apps.schedule.urls")),
    path("", include("apps.attendance.urls")),
    path("", include("apps.exams.urls")),
    path("", include("apps.finance.urls")),
    path("", include("apps.payroll.urls")),
    path("", include("apps.crm.urls")),
    path("", include("apps.reporting.urls")),
]

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include((api_patterns, "api"), namespace="api")),
]

# Built SPA (frontend/dist) is served by Django outside DEBUG as well, so a
# single process can host the whole product. In DEBUG the Vite dev server is
# used instead and proxies /api here.
urlpatterns += [re_path(r"^(?!api/|admin/|static/|media/).*$", spa_index)]

if settings.DEBUG:
    from django.conf.urls.static import static

    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
