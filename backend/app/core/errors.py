class DomainError(Exception):
    """Erro de regra de negócio; a mensagem vai para o usuário (pt-BR)."""

    status = 422
    code = "invalid"

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class NotFoundError(DomainError):
    status = 404
    code = "not_found"


class ForbiddenError(DomainError):
    status = 403
    code = "forbidden"


class ConflictError(DomainError):
    status = 409
    code = "conflict"


class RateLimitedError(DomainError):
    status = 429
    code = "rate_limited"
