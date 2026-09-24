"""Parser de notação de dados (sem eval).

Gramática aceita (espaços são ignorados, maiúsculas/minúsculas tanto faz):

    expressao := termo (('+' | '-') termo)*
    termo     := dados | inteiro
    dados     := [N] 'd' (LADOS | '%') ['!'] [('kh' | 'kl') K]

Exemplos: ``d20``, ``1d20+5``, ``2d20kh1`` (vantagem), ``4d6kh3``, ``d%``, ``3d6-2``, ``1d1000``.
``!`` = dado que explode (Savage Worlds): no valor máximo rola de novo e soma, ex.: ``1d8!``.
"""

import re
from dataclasses import dataclass

ALLOWED_SIDES = frozenset({2, 4, 5, 6, 8, 10, 12, 16, 20, 24, 30, 60, 100, 1000})
MAX_DICE = 100
MAX_MODIFIER = 10_000
MAX_NOTATION_LENGTH = 64

_TERM = re.compile(
    r"(?:(?P<count>\d*)d(?P<sides>\d+|%)(?P<explode>!)?(?:(?P<keep>kh|kl)(?P<keep_n>\d+))?|(?P<const>\d+))"
)


class NotationError(ValueError):
    pass


@dataclass(frozen=True)
class DiceTerm:
    count: int
    sides: int
    sign: int = 1
    keep: str | None = None  # "kh" ou "kl"
    keep_n: int | None = None
    explode: bool = False

    @property
    def kept_count(self) -> int:
        return self.keep_n if self.keep_n is not None else self.count

    def canonical(self) -> str:
        suffix = f"{self.keep}{self.keep_n}" if self.keep else ""
        return f"{self.count}d{self.sides}{'!' if self.explode else ''}{suffix}"


@dataclass(frozen=True)
class DiceExpression:
    terms: tuple[DiceTerm, ...]
    modifier: int

    def canonical(self) -> str:
        out = ""
        for i, term in enumerate(self.terms):
            if term.sign < 0:
                out += "-"
            elif i > 0:
                out += "+"
            out += term.canonical()
        if self.modifier > 0:
            out += f"+{self.modifier}"
        elif self.modifier < 0:
            out += str(self.modifier)
        return out


def parse(notation: str) -> DiceExpression:
    if not notation or len(notation) > MAX_NOTATION_LENGTH:
        raise NotationError("Notação vazia ou longa demais.")
    source = re.sub(r"\s+", "", notation).lower()
    if not source:
        raise NotationError("Notação vazia.")

    terms: list[DiceTerm] = []
    modifier = 0
    pos = 0
    first = True
    while pos < len(source):
        sign = 1
        if source[pos] in "+-":
            sign = -1 if source[pos] == "-" else 1
            pos += 1
        elif not first:
            raise NotationError(f"Esperado '+' ou '-' na posição {pos + 1}.")
        match = _TERM.match(source, pos)
        if not match or match.end() == pos:
            raise NotationError(f"Termo inválido na posição {pos + 1}.")
        pos = match.end()
        first = False

        if match.group("const") is not None:
            modifier += sign * int(match.group("const"))
            continue

        count = int(match.group("count")) if match.group("count") else 1
        sides = 100 if match.group("sides") == "%" else int(match.group("sides"))
        if sides not in ALLOWED_SIDES:
            raise NotationError(f"Dado d{sides} não é suportado.")
        if count < 1:
            raise NotationError("A quantidade de dados deve ser pelo menos 1.")
        keep = match.group("keep")
        keep_n = int(match.group("keep_n")) if keep else None
        if keep_n is not None and not 1 <= keep_n <= count:
            raise NotationError(f"Não dá para manter {keep_n} de {count} dados.")
        explode = match.group("explode") is not None
        if explode and sides < 3:
            raise NotationError("Só dados de 3 lados ou mais podem explodir.")
        terms.append(DiceTerm(count=count, sides=sides, sign=sign, keep=keep, keep_n=keep_n, explode=explode))

    if not terms:
        raise NotationError("A expressão precisa ter pelo menos um dado.")
    if sum(t.count for t in terms) > MAX_DICE:
        raise NotationError(f"No máximo {MAX_DICE} dados por rolagem.")
    if abs(modifier) > MAX_MODIFIER:
        raise NotationError("Modificador grande demais.")
    return DiceExpression(terms=tuple(terms), modifier=modifier)
