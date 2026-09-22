"""Serializers for users, roles, permissions and authentication."""

from __future__ import annotations

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from .models import Permission, Role, User
from .rbac import ROLE_MATRIX, navigation_for


class PermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = ("id", "code", "name", "module", "description")
        read_only_fields = fields


class RoleSerializer(serializers.ModelSerializer):
    permission_codes = serializers.SerializerMethodField()
    user_count = serializers.IntegerField(source="users.count", read_only=True)

    class Meta:
        model = Role
        fields = (
            "id", "code", "name", "description", "is_system",
            "permissions", "permission_codes", "user_count",
        )
        extra_kwargs = {"permissions": {"required": False}}

    def get_permission_codes(self, obj) -> list[str]:
        return sorted(obj.permission_codes())

    def validate(self, attrs):
        role_code = attrs.get("code", getattr(self.instance, "code", None))
        permissions = attrs.get("permissions")
        if permissions is not None and role_code == "super_admin":
            raise serializers.ValidationError(
                {"permissions": "The Super Admin role always holds every permission."}
            )
        return attrs


class UserSerializer(serializers.ModelSerializer):
    """Read representation. Never exposes password material."""

    full_name = serializers.CharField(read_only=True)
    role_code = serializers.CharField(read_only=True)
    role_name = serializers.CharField(read_only=True)
    extra_permission_codes = serializers.SerializerMethodField()
    permission_codes = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            "id", "username", "first_name", "last_name", "full_name", "email", "phone",
            "role", "role_code", "role_name", "is_active", "is_superuser",
            "extra_permissions", "extra_permission_codes", "permission_codes",
            "last_login", "last_password_change", "created_at",
        )
        read_only_fields = (
            "is_superuser", "last_login", "last_password_change", "created_at",
        )

    def get_extra_permission_codes(self, obj) -> list[str]:
        return sorted(obj.extra_permission_codes())

    def get_permission_codes(self, obj) -> list[str]:
        return sorted(obj.permission_codes())


class UserWriteSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, allow_blank=False)

    class Meta:
        model = User
        fields = (
            "id", "username", "first_name", "last_name", "email", "phone",
            "role", "is_active", "extra_permissions", "password",
        )

    def validate_password(self, value: str) -> str:
        try:
            validate_password(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages)) from exc
        return value

    def validate_username(self, value: str) -> str:
        return value.strip().lower()

    def validate(self, attrs):
        if not self.instance and not attrs.get("password"):
            raise serializers.ValidationError({"password": "A password is required for new users."})
        role = attrs.get("role", getattr(self.instance, "role", None))
        is_active = attrs.get("is_active", getattr(self.instance, "is_active", True))
        if role is None and not is_active:
            raise serializers.ValidationError(
                {"role": "An inactive user must still be assigned a role."}
            )
        return attrs

    def create(self, validated_data):
        password = validated_data.pop("password")
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        for key, value in validated_data.items():
            setattr(instance, key, value)
        if password:
            instance.set_password(password)
        instance.save()
        return instance


class MeSerializer(UserSerializer):
    """Adds the permission list and role-filtered navigation for the SPA shell."""

    navigation = serializers.SerializerMethodField()

    class Meta(UserSerializer.Meta):
        fields = UserSerializer.Meta.fields + ("navigation",)

    def get_navigation(self, obj) -> list[dict]:
        return navigation_for(obj)


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(write_only=True, style={"input_type": "password"})

    def validate(self, attrs):
        username = attrs["username"].strip().lower()
        attrs["username"] = username
        return attrs


class PasswordChangeSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True)

    def validate_current_password(self, value):
        user = self.context["request"].user
        if not user.check_password(value):
            raise serializers.ValidationError("Current password is incorrect.")
        return value

    def validate_new_password(self, value):
        try:
            validate_password(value, self.context["request"].user)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages)) from exc
        return value


class AdminPasswordResetSerializer(serializers.Serializer):
    new_password = serializers.CharField(write_only=True)

    def validate_new_password(self, value):
        try:
            validate_password(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages)) from exc
        return value


class RoleMatrixSerializer(serializers.Serializer):
    """Reference payload describing the canonical role → permission matrix."""

    roles = serializers.SerializerMethodField()

    def get_roles(self, obj) -> list[dict]:
        from .models import Role as RoleModel

        return [
            {
                "code": role.code,
                "name": role.get_code_display() if hasattr(role, "get_code_display") else role.name,
                "description": role.description or role.default_description,
                "is_system": role.is_system,
                "permissions": sorted(role.permission_codes()),
            }
            for role in RoleModel.objects.all()
        ]
