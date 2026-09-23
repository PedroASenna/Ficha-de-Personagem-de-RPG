import re
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

USERNAME_RE = re.compile(r"^[a-z0-9_.-]{3,32}$")


def normalize_username(value: str) -> str:
    value = value.strip().lower()
    if not USERNAME_RE.match(value):
        raise ValueError("Use de 3 a 32 caracteres: letras minúsculas, números, ponto, hífen ou _.")
    return value


class RegisterIn(BaseModel):
    username: str = Field(max_length=32)
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=2, max_length=40)
    locale: str = Field(default="pt-BR", max_length=10)

    @field_validator("username")
    @classmethod
    def _username(cls, value: str) -> str:
        return normalize_username(value)

    @field_validator("display_name")
    @classmethod
    def _strip(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError("Nome muito curto.")
        return value


class LoginIn(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=128)

    @field_validator("username")
    @classmethod
    def _lower(cls, value: str) -> str:
        return value.strip().lower()


class RefreshIn(BaseModel):
    refresh_token: str = Field(max_length=200)


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    display_name: str
    locale: str
    is_admin: bool
    created_at: datetime


class UserPatch(BaseModel):
    display_name: str | None = Field(default=None, min_length=2, max_length=40)
    locale: str | None = Field(default=None, max_length=10)


class PasswordChangeIn(BaseModel):
    current_password: str = Field(max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class AdminPasswordResetIn(BaseModel):
    new_password: str = Field(min_length=8, max_length=128)


class DiscoveryOut(BaseModel):
    app: str = "rpgplay"
    name: str
    version: str
    server_id: str
    port: int
    registration_open: bool
    master_path: str = "/mestre"
