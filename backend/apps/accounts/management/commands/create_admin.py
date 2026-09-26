"""Create the first administrator safely.

`createsuperuser` is not enough on its own: this application drives access from
``User.role``, so a superuser with no role renders the CRM unusable (every
permission check resolves against a missing role). This command creates a user
that is both a Django superuser and a member of the ``super_admin`` role.

The password is never passed as an argument (arguments leak into shell history
and process listings). Supply it through the environment, or let the command
prompt for it with confirmation:

    DJANGO_ADMIN_PASSWORD='...' python manage.py create_admin --username admin

Idempotent: re-running with an existing username updates the role/flags and,
only when a password is supplied, resets it.
"""

from __future__ import annotations

import os
import sys

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.models import Permission, Role, User
from apps.accounts.rbac import PERMISSION_CATALOG, ROLE_SUPER_ADMIN

ENV_PASSWORD = "DJANGO_ADMIN_PASSWORD"


class Command(BaseCommand):
    help = "Create (or repair) the initial administrator account with the super_admin role."

    def add_arguments(self, parser) -> None:
        parser.add_argument("--username", default="admin", help="Username (default: admin).")
        parser.add_argument("--email", default="", help="Email address (optional).")
        parser.add_argument("--first-name", default="", help="First name (optional).")
        parser.add_argument("--last-name", default="", help="Last name (optional).")
        parser.add_argument(
            "--no-input",
            action="store_true",
            help=f"Never prompt; require {ENV_PASSWORD} to be set instead.",
        )

    def _resolve_password(self, *, no_input: bool) -> str:
        from_env = os.environ.get(ENV_PASSWORD, "")
        if from_env:
            return from_env
        if no_input or not sys.stdin.isatty():
            raise CommandError(
                f"No password supplied. Set {ENV_PASSWORD} in the environment, "
                f"e.g. {ENV_PASSWORD}='<strong-password>' python manage.py create_admin"
            )
        # getpass is imported lazily so the module imports cleanly headless.
        from getpass import getpass

        first = getpass("Password: ")
        second = getpass("Password (again): ")
        if first != second:
            raise CommandError("Passwords did not match.")
        return first

    def handle(self, *args, **options):
        from django.contrib.auth.password_validation import validate_password
        from django.core.exceptions import ValidationError as DjangoValidationError

        username = (options["username"] or "").strip().lower()
        if not username:
            raise CommandError("--username cannot be empty.")

        password = self._resolve_password(no_input=options["no_input"])

        try:
            validate_password(password)
        except DjangoValidationError as exc:
            raise CommandError("Password rejected: " + "; ".join(exc.messages)) from exc

        role = Role.objects.filter(code=ROLE_SUPER_ADMIN).first()
        if role is None:
            raise CommandError(
                "The super_admin role does not exist. Run `python manage.py sync_rbac` first."
            )

        with transaction.atomic():
            user, created = User.objects.get_or_create(username=username)
            user.is_staff = True
            user.is_superuser = True
            user.is_active = True
            user.role = role
            if options["email"]:
                user.email = options["email"]
            if options["first_name"]:
                user.first_name = options["first_name"]
            if options["last_name"]:
                user.last_name = options["last_name"]
            user.set_password(password)
            user.save()

        # A superuser's effective permission set is the whole catalog regardless
        # of the role rows, but keep the role in sync so the UI shows it.
        role.permissions.set(Permission.objects.all())

        verb = "Created" if created else "Updated"
        total = len(PERMISSION_CATALOG)
        self.stdout.write(
            self.style.SUCCESS(
                f"{verb} administrator {username!r} with role '{ROLE_SUPER_ADMIN}' "
                f"({total} permissions available)."
            )
        )
        self.stdout.write("Sign in and change this password if it was shared insecurely.")
