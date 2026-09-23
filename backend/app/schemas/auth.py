import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)
    display_name: str = Field(min_length=2, max_length=40)
    locale: str = Field(default="pt-BR", max_length=10)
    # Age gate (13+) e aceite dos termos/política: obrigatórios para Play Store e LGPD.
    age_confirmed: bool
    accept_terms: bool

    @field_validator("email")
    @classmethod
    def _lower(cls, value: str) -> str:
        return value.lower()

    @field_validator("display_name")
    @classmethod
    def _strip(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError("Nome muito curto.")
        return value

    @field_validator("age_confirmed")
    @classmethod
    def _age(cls, value: bool) -> bool:
        if not value:
            raise ValueError("É preciso ter 13 anos ou mais para usar o app.")
        return value

    @field_validator("accept_terms")
    @classmethod
    def _terms(cls, value: bool) -> bool:
        if not value:
            raise ValueError("É preciso aceitar os Termos de Uso e a Política de Privacidade.")
        return value


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=128)

    @field_validator("email")
    @classmethod
    def _lower(cls, value: str) -> str:
        return value.lower()


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
    email: str
    display_name: str
    locale: str
    created_at: datetime


class UserPatch(BaseModel):
    display_name: str | None = Field(default=None, min_length=2, max_length=40)
    locale: str | None = Field(default=None, max_length=10)
