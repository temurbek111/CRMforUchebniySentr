"""Create or refresh permission rows and roles from the canonical RBAC matrix."""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.accounts.models import Permission, Role
from apps.accounts.rbac import (
    PERMISSION_CATALOG,
    ROLE_CHOICES,
    ROLE_DESCRIPTIONS,
    ROLE_MATRIX,
    ROLE_SUPER_ADMIN,
)


class Command(BaseCommand):
    help = "Sync the Permission catalog and system Roles with the RBAC matrix."

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset-permissions",
            action="store_true",
            help="Force every system role back to the canonical permission set.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        created_perms, updated_perms = 0, 0
        for code, name, module in PERMISSION_CATALOG:
            permission, created = Permission.objects.update_or_create(
                code=code,
                defaults={"name": name, "module": module,
                          "description": f"{name} ({module})"},
            )
            created_perms += 1 if created else 0
            updated_perms += 0 if created else 1

        created_roles, synced = 0, 0
        for code, label in ROLE_CHOICES:
            role, created = Role.objects.update_or_create(
                code=code,
                defaults={
                    "name": label,
                    "description": ROLE_DESCRIPTIONS.get(code, ""),
                    "is_system": True,
                },
            )
            created_roles += 1 if created else 0
            if created or options["reset_permissions"] or code == ROLE_SUPER_ADMIN:
                role.sync_from_matrix()
                synced += 1
            else:
                # Guarantee new codes reach existing roles without dropping custom grants.
                missing = ROLE_MATRIX[code] - role.permission_codes()
                if missing:
                    role.permissions.add(*Permission.objects.filter(code__in=missing))
                    synced += 1

        self.stdout.write(self.style.SUCCESS(
            f"Permissions: {created_perms} created, {updated_perms} refreshed. "
            f"Roles: {created_roles} created, {synced} synced."
        ))
