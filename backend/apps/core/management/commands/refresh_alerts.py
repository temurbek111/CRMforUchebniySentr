"""Refresh the alert notifications for a scheduled run.

Materialises the current operational alerts into the notification centre with
deduplication, so the same warning is not raised twice on the same day. Intended
for a daily cron/systemd timer:

    manage.py refresh_alerts

Notification delivery to external providers (Telegram, SMS, email) is a provider
concern handled later; this command only maintains the internal centre and the
per-day dedupe keys.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand

from apps.core.models import Notification
from apps.reporting.services import build_alerts, sync_notifications


class Command(BaseCommand):
    help = "Materialise current alerts into the notification centre (deduplicated)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run", action="store_true",
            help="Show what would be created without writing anything.",
        )

    def handle(self, *args, **options):
        if options["dry_run"]:
            alerts = build_alerts()
            self.stdout.write(f"{len(alerts)} alert(s) currently active:")
            for alert in alerts:
                self.stdout.write(
                    f"  [{alert['severity']:<8}] {alert['title']} → {alert['link']}"
                )
            return

        result = sync_notifications()
        total = Notification.objects.count()
        unread = Notification.objects.filter(read_at__isnull=True).count()
        self.stdout.write(self.style.SUCCESS(
            f"{result['date']}: {result['created']} created, "
            f"{result['already_present']} already present "
            f"({total} total, {unread} unread)."
        ))
