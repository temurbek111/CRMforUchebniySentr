"""Authentication and user/role administration endpoints."""

from __future__ import annotations

from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.db import transaction
from django.middleware.csrf import get_token
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.audit import log_action
from apps.core.models import AuditLog

from .models import Permission, Role, User
from .rbac import Perm, RequirePerms, navigation_for
from .serializers import (
    AdminPasswordResetSerializer,
    LoginSerializer,
    MeSerializer,
    PasswordChangeSerializer,
    PermissionSerializer,
    RoleSerializer,
    UserSerializer,
    UserWriteSerializer,
)


class CsrfView(APIView):
    """Issues the CSRF cookie the SPA must echo back in X-CSRFToken."""

    permission_classes = [AllowAny]
    authentication_classes: list = []

    def get(self, request):
        return Response({"csrfToken": get_token(request)})


class LoginView(APIView):
    permission_classes = [AllowAny]
    authentication_classes: list = []

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = authenticate(
            request,
            username=serializer.validated_data["username"],
            password=serializer.validated_data["password"],
        )
        if user is None:
            return Response(
                {"detail": "Invalid credentials.", "errors": {"non_field_errors": ["Invalid credentials."]}},
                status=status.HTTP_401_UNAUTHORIZED,
            )
        if not user.is_active:
            return Response(
                {"detail": "This account is disabled.", "errors": {"non_field_errors": ["Account disabled."]}},
                status=status.HTTP_403_FORBIDDEN,
            )
        login(request, user)
        log_action(
            AuditLog.Action.LOGIN, "user", entity_id=user.pk, actor=user,
            summary=f"{user.full_name} signed in", request=request,
        )
        return Response(MeSerializer(user, context={"request": request}).data)


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        log_action(
            AuditLog.Action.LOGOUT, "user", entity_id=request.user.pk, actor=request.user,
            summary=f"{request.user.full_name} signed out", request=request,
        )
        logout(request)
        return Response({"detail": "Signed out."})


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(MeSerializer(request.user, context={"request": request}).data)

    def patch(self, request):
        allowed = {"first_name", "last_name", "email", "phone"}
        payload = {k: v for k, v in request.data.items() if k in allowed}
        serializer = UserSerializer(
            request.user, data=payload, partial=True, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(MeSerializer(request.user, context={"request": request}).data)


class PasswordChangeView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = PasswordChangeSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = request.user
        user.set_password(serializer.validated_data["new_password"])
        user.last_password_change = timezone.now()
        user.save(update_fields=["password", "last_password_change"])
        update_session_auth_hash(request, user)
        log_action(
            AuditLog.Action.PERMISSION, "user", entity_id=user.pk, actor=user,
            summary=f"{user.full_name} changed their own password", request=request,
        )
        return Response({"detail": "Password updated."})


class MyNavigationView(APIView):
    """Role-filtered navigation for the current user."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({"navigation": navigation_for(request.user)})


class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.select_related("role").prefetch_related("extra_permissions")
    permission_classes = [RequirePerms(Perm.USERS_VIEW)]
    filterset_fields = ["role", "is_active"]
    search_fields = ["username", "first_name", "last_name", "email", "phone"]
    ordering_fields = ["first_name", "last_name", "username", "created_at"]
    ordering = ["first_name"]

    def get_serializer_class(self):
        if self.action in {"create", "update", "partial_update"}:
            return UserWriteSerializer
        return UserSerializer

    def get_permissions(self):
        # get_permissions() must return instances; DRF only auto-instantiates
        # the entries of `permission_classes`.
        if self.action in {"create", "update", "partial_update", "destroy",
                           "reset_password", "toggle_active"}:
            return [RequirePerms(Perm.USERS_MANAGE)()]
        return [RequirePerms(Perm.USERS_VIEW)()]

    def perform_create(self, serializer):
        user = serializer.save()
        log_action(
            AuditLog.Action.PERMISSION, "user", entity_id=user.pk, actor=self.request.user,
            new={"username": user.username, "role": user.role_code, "is_active": user.is_active},
            summary=f"Created user {user.username} with role {user.role_name}",
            request=self.request,
        )

    def perform_update(self, serializer):
        before = {
            "role": serializer.instance.role_code,
            "is_active": serializer.instance.is_active,
            "permissions": sorted(serializer.instance.permission_codes()),
        }
        user = serializer.save()
        after = {
            "role": user.role_code,
            "is_active": user.is_active,
            "permissions": sorted(user.permission_codes()),
        }
        log_action(
            AuditLog.Action.PERMISSION, "user", entity_id=user.pk, actor=self.request.user,
            old=before, new=after,
            summary=f"Updated user {user.username} (role {after['role']})",
            request=self.request,
        )

    def destroy(self, request, *args, **kwargs):
        """Users are deactivated, never deleted - history must stay intact."""
        user = self.get_object()
        if user.pk == request.user.pk:
            return Response(
                {"detail": "You cannot deactivate your own account.",
                 "errors": {"non_field_errors": ["Self-deactivation is blocked."]}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user.is_active = False
        user.save(update_fields=["is_active"])
        log_action(
            AuditLog.Action.PERMISSION, "user", entity_id=user.pk, actor=request.user,
            new={"is_active": False}, summary=f"Deactivated user {user.username}",
            request=request,
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"], url_path="reset-password")
    def reset_password(self, request, pk=None):
        user = self.get_object()
        serializer = AdminPasswordResetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            user.set_password(serializer.validated_data["new_password"])
            user.last_password_change = timezone.now()
            user.save(update_fields=["password", "last_password_change"])
        log_action(
            AuditLog.Action.PERMISSION, "user", entity_id=user.pk, actor=request.user,
            summary=f"Reset password for {user.username}", request=request,
        )
        return Response({"detail": f"Password reset for {user.username}."})

    @action(detail=True, methods=["post"], url_path="toggle-active")
    def toggle_active(self, request, pk=None):
        user = self.get_object()
        if user.pk == request.user.pk:
            return Response(
                {"detail": "You cannot disable your own account.",
                 "errors": {"non_field_errors": ["Self-deactivation is blocked."]}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user.is_active = not user.is_active
        user.save(update_fields=["is_active"])
        log_action(
            AuditLog.Action.PERMISSION, "user", entity_id=user.pk, actor=request.user,
            new={"is_active": user.is_active},
            summary=f"{'Activated' if user.is_active else 'Deactivated'} user {user.username}",
            request=request,
        )
        return Response(UserSerializer(user).data)


class RoleViewSet(viewsets.ModelViewSet):
    queryset = Role.objects.prefetch_related("permissions").all()
    serializer_class = RoleSerializer
    permission_classes = [RequirePerms(Perm.ROLES_MANAGE)]
    filterset_fields = ["code", "is_system"]
    search_fields = ["code", "name"]

    def destroy(self, request, *args, **kwargs):
        role = self.get_object()
        if role.is_system:
            return Response(
                {"detail": "System roles cannot be deleted.",
                 "errors": {"non_field_errors": ["System role is protected."]}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if role.users.exists():
            return Response(
                {"detail": "Reassign the users of this role before deleting it.",
                 "errors": {"non_field_errors": ["Role still has users."]}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().destroy(request, *args, **kwargs)

    def perform_update(self, serializer):
        before = sorted(serializer.instance.permission_codes())
        role = serializer.save()
        after = sorted(role.permission_codes())
        if before != after:
            log_action(
                AuditLog.Action.PERMISSION, "role", entity_id=role.pk, actor=self.request.user,
                old={"permissions": before}, new={"permissions": after},
                summary=f"Changed permissions for role {role.name}",
                request=self.request,
            )

    @action(detail=True, methods=["post"], url_path="reset-to-default")
    def reset_to_default(self, request, pk=None):
        role = self.get_object()
        if role.code not in __import__("apps.accounts.rbac", fromlist=["ROLE_MATRIX"]).ROLE_MATRIX:
            return Response(
                {"detail": "This role has no canonical definition to restore.",
                 "errors": {"non_field_errors": ["No canonical matrix."]}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        role.sync_from_matrix()
        log_action(
            AuditLog.Action.PERMISSION, "role", entity_id=role.pk, actor=request.user,
            new={"permissions": sorted(role.permission_codes())},
            summary=f"Restored default permissions for role {role.name}",
            request=request,
        )
        return Response(RoleSerializer(role).data)


class PermissionViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """The permission catalog, used by the role editor UI."""

    queryset = Permission.objects.all()
    serializer_class = PermissionSerializer
    permission_classes = [RequirePerms(Perm.ROLES_MANAGE)]
    filterset_fields = ["module"]
    search_fields = ["code", "name", "module"]
    pagination_class = None
