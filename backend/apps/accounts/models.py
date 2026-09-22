"""User, Role and Permission models."""

from __future__ import annotations

from django.contrib.auth.models import AbstractUser
from django.db import models

from .rbac import (
    ROLE_CHOICES,
    ROLE_DESCRIPTIONS,
    ROLE_MATRIX,
    ROLE_SUPER_ADMIN,
    permissions_for_role,
)


class Permission(models.Model):
    """A single capability, e.g. ``finance.manage``."""

    code = models.CharField(max_length=64, unique=True)
    name = models.CharField(max_length=160)
    module = models.CharField(max_length=64, db_index=True)
    description = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ("module", "code")
        verbose_name = "Permission"

    def __str__(self) -> str:
        return self.code


class Role(models.Model):
    """A named bundle of permissions. System roles are protected from deletion."""

    code = models.CharField(max_length=32, unique=True, choices=ROLE_CHOICES)
    name = models.CharField(max_length=80)
    description = models.CharField(max_length=255, blank=True)
    permissions = models.ManyToManyField(Permission, blank=True, related_name="roles")
    is_system = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("code",)

    def __str__(self) -> str:
        return self.name

    def permission_codes(self) -> set[str]:
        return set(self.permissions.values_list("code", flat=True))

    def sync_from_matrix(self) -> None:
        """Reset this role's permissions to the canonical matrix definition."""
        codes = ROLE_MATRIX.get(self.code)
        if codes is None:
            return
        self.permissions.set(Permission.objects.filter(code__in=codes))

    @property
    def default_description(self) -> str:
        return ROLE_DESCRIPTIONS.get(self.code, "")


class User(AbstractUser):
    """Staff account. Access is driven by ``role`` plus explicit extra grants."""

    role = models.ForeignKey(
        Role, null=True, blank=True, on_delete=models.PROTECT, related_name="users"
    )
    phone = models.CharField(max_length=32, blank=True)
    extra_permissions = models.ManyToManyField(
        Permission,
        blank=True,
        related_name="granted_users",
        help_text="Additional capabilities granted to this user beyond their role.",
    )
    last_password_change = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("first_name", "last_name", "username")

    def __str__(self) -> str:
        return self.full_name or self.username

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip() or self.username

    @property
    def role_code(self) -> str | None:
        if self.role_id and self.role:
            return self.role.code
        return ROLE_SUPER_ADMIN if self.is_superuser else None

    @property
    def role_name(self) -> str:
        if self.role_id and self.role:
            return self.role.name
        return "Super Admin" if self.is_superuser else "No role"

    def extra_permission_codes(self) -> set[str]:
        return set(self.extra_permissions.values_list("code", flat=True))

    def permission_codes(self) -> set[str]:
        """Effective codes: role permissions plus explicit grants (or everything)."""
        if self.is_superuser:
            from .rbac import ALL_PERMISSIONS

            return set(ALL_PERMISSIONS)
        codes = set(permissions_for_role(self.role_code))
        codes |= self.extra_permission_codes()
        return codes

    def has_perm_code(self, code: str) -> bool:
        return code in self.permission_codes()

    @property
    def teacher_profile_id(self) -> int | None:
        profile = getattr(self, "teacher_profile", None)
        return profile.pk if profile else None
