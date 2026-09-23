import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.core.config import Settings

_hasher = PasswordHasher()
_ALGORITHM = "HS256"


class InvalidTokenError(Exception):
    pass


def _secret(settings: Settings) -> str:
    if settings.jwt_secret is None:
        raise RuntimeError("Segredo JWT não resolvido (use ensure_runtime_secrets)")
    return settings.jwt_secret.get_secret_value()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def create_access_token(settings: Settings, user_id: uuid.UUID) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "type": "access",
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_access_ttl_minutes),
    }
    return jwt.encode(payload, _secret(settings), algorithm=_ALGORITHM)


def decode_access_token(settings: Settings, token: str) -> uuid.UUID:
    try:
        payload = jwt.decode(token, _secret(settings), algorithms=[_ALGORITHM])
    except jwt.PyJWTError as exc:
        raise InvalidTokenError(str(exc)) from exc
    if payload.get("type") != "access":
        raise InvalidTokenError("tipo de token inválido")
    try:
        return uuid.UUID(payload["sub"])
    except (KeyError, ValueError) as exc:
        raise InvalidTokenError("sub inválido") from exc


def new_refresh_token() -> tuple[str, str]:
    """Retorna (token em claro para o cliente, hash sha256 para o banco)."""
    token = secrets.token_urlsafe(48)
    return token, hash_refresh_token(token)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
