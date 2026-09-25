import hashlib
from collections.abc import Mapping

from django.contrib.auth import authenticate, get_user_model, login, logout
from django.core.cache import cache
from django.db import transaction
from django.db.models import Q
from django.middleware.csrf import get_token
from django.views.decorators.csrf import csrf_protect
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .models import UserProfile
from .serializers import AuthUserSerializer, LoginSerializer, ProfileUpdateSerializer

User = get_user_model()

LOGIN_FAILURE_LIMIT = 5
LOGIN_FAILURE_WINDOW = 60
LOGIN_LOCK_WINDOW = 30


def _login_cache_key(request, identifier):
    client_address = str(request.META.get("REMOTE_ADDR") or "unknown")
    material = f"{client_address}:{identifier.casefold()}".encode("utf-8")
    return f"event-login:{hashlib.sha256(material).hexdigest()}"


def _record_failed_login(cache_key):
    if cache.add(cache_key, 1, timeout=LOGIN_FAILURE_WINDOW):
        failures = 1
    else:
        try:
            failures = cache.incr(cache_key)
        except ValueError:
            cache.set(cache_key, 1, timeout=LOGIN_FAILURE_WINDOW)
            failures = 1
    if failures >= LOGIN_FAILURE_LIMIT:
        cache.set(f"{cache_key}:locked", True, LOGIN_LOCK_WINDOW)
    return failures


@api_view(["GET"])
@permission_classes([AllowAny])
def csrf(request):
    return Response({"csrfToken": get_token(request)})


@api_view(["POST"])
@permission_classes([AllowAny])
@csrf_protect
def login_view(request):
    if not isinstance(request.data, Mapping):
        return Response({"detail": "Request body must be a JSON object."}, status=400)

    serializer = LoginSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    identifier = serializer.validated_data["identifier"]
    password = serializer.validated_data["password"]

    cache_key = _login_cache_key(request, identifier)
    lock_key = f"{cache_key}:locked"
    if cache.get(lock_key):
        return Response(
            {"detail": "Too many failed attempts. Try again in 30 seconds."},
            status=429,
        )

    matching_users = list(
        User.objects.filter(
            Q(username__iexact=identifier) | Q(email__iexact=identifier)
        ).order_by("id")[:2]
    )
    if len(matching_users) > 1:
        _record_failed_login(cache_key)
        return Response(
            {"detail": "The ID/username or password is incorrect."}, status=400
        )

    user = matching_users[0] if matching_users else None
    authenticated = authenticate(
        request, username=user.username if user else identifier, password=password
    )
    if not authenticated or not UserProfile.objects.filter(user=authenticated).exists():
        _record_failed_login(cache_key)
        return Response(
            {"detail": "The ID/username or password is incorrect."}, status=400
        )

    cache.delete(cache_key)
    cache.delete(lock_key)
    request.session.cycle_key()
    login(request, authenticated)
    return Response(AuthUserSerializer(authenticated).data)


@api_view(["POST"])
@permission_classes([AllowAny])
@csrf_protect
def logout_view(request):
    logout(request)
    return Response(status=204)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me(request):
    if not UserProfile.objects.filter(user=request.user).exists():
        return Response({"detail": "User profile is not configured."}, status=409)
    return Response(AuthUserSerializer(request.user).data)


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def profile(request):
    if not UserProfile.objects.filter(user=request.user).exists():
        return Response({"detail": "User profile is not configured."}, status=409)
    if request.method == "GET":
        return Response(AuthUserSerializer(request.user).data)

    if not isinstance(request.data, Mapping):
        return Response({"detail": "Request body must be a JSON object."}, status=400)
    serializer = ProfileUpdateSerializer(
        data=request.data, context={"request": request}
    )
    serializer.is_valid(raise_exception=True)
    values = serializer.validated_data

    with transaction.atomic():
        if "email" in values:
            request.user.email = values["email"].strip()
            request.user.save(update_fields=["email"])
        user_profile = UserProfile.objects.select_for_update().get(user=request.user)
        profile_fields = []
        if "name" in values:
            user_profile.display_name = values["name"]
            profile_fields.append("display_name")
        if "phone" in values:
            user_profile.phone = values["phone"].strip()
            profile_fields.append("phone")
        if profile_fields:
            user_profile.save(update_fields=profile_fields)

    return Response(AuthUserSerializer(request.user).data)
