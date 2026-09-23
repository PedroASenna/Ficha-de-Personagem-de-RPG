"""Gera os efeitos sonoros do app por síntese (sem assets de terceiros → sem questão de licença).

    python3 scripts/gen_sfx.py   # grava em assets/sfx/*.wav

Troque por sons profissionais quando houver orçamento; mantenha os mesmos nomes de arquivo,
que são as chaves "sound" enviadas pelo servidor (shared/dice-effects.json).
"""

import math
import random
import struct
import wave
from pathlib import Path

RATE = 22050
OUT = Path(__file__).resolve().parents[1] / "assets" / "sfx"


def envelope(i: int, n: int, attack: float = 0.005, release: float = 0.6) -> float:
    t = i / RATE
    total = n / RATE
    if t < attack:
        return t / attack
    return max(0.0, 1 - (t - attack) / max(1e-6, total * release)) ** 2


def write(name: str, samples: list[float]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    peak = max(1e-6, max(abs(s) for s in samples))
    with wave.open(str(OUT / f"{name}.wav"), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        wav.writeframes(b"".join(struct.pack("<h", int(32767 * 0.85 * s / peak)) for s in samples))


def tone(freqs: list[float], seconds: float, release: float = 0.7, noise: float = 0.0, glide: float = 0.0) -> list[float]:
    n = int(RATE * seconds)
    rng = random.Random(len(freqs) * 7 + int(seconds * 100))
    out = []
    for i in range(n):
        t = i / RATE
        s = sum(math.sin(2 * math.pi * (f + glide * t) * t) / (k + 1) for k, f in enumerate(freqs))
        s += noise * (rng.random() * 2 - 1)
        out.append(s * envelope(i, n, release=release))
    return out


def concat(*parts: list[float]) -> list[float]:
    return [s for p in parts for s in p]


def main() -> None:
    # Falha crítica: impacto seco e grave, com ruído (dado "rachando").
    write("impact_dry", tone([55, 82, 110], 0.45, release=0.35, noise=0.9, glide=-40))
    # Resultado baixo: baque abafado.
    write("thud_soft", tone([90, 135], 0.25, release=0.4, noise=0.25))
    # Neutro: "clack" curto de dado na mesa.
    write("clack", tone([1400, 2100], 0.08, release=0.5, noise=0.6))
    # Alto: sino brilhante.
    write("chime", tone([1046.5, 1318.5, 1568], 0.7, release=0.8))
    # Crítico: fanfarra em arpejo maior (Dó-Mi-Sol-Dó).
    notes = [523.25, 659.25, 783.99]
    arpeggio = concat(*(tone([f, f * 2], 0.13, release=0.9) for f in notes))
    write("epic_fanfare", concat(arpeggio, tone([1046.5, 1318.5, 1568, 2093], 0.9, release=0.85)))
    # Cura e dano no HUD.
    write("heal_sparkle", tone([880, 1320, 1760], 0.5, release=0.8, glide=300))
    write("hit_flesh", tone([70, 140], 0.3, release=0.4, noise=0.7, glide=-60))


if __name__ == "__main__":
    main()
