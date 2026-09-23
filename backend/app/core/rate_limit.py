import time
from collections import defaultdict, deque


class RateLimiter:
    """Janela deslizante em memória.

    Suficiente para uma instância. Com várias instâncias no Cloud Run o limite vale por instância;
    para um limite global, troque por um contador no Redis (Memorystore) com a mesma interface.
    """

    def __init__(self, max_events: int, per_seconds: float) -> None:
        self.max_events = max_events
        self.per_seconds = per_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        hits = self._hits[key]
        while hits and now - hits[0] > self.per_seconds:
            hits.popleft()
        if len(hits) >= self.max_events:
            return False
        hits.append(now)
        return True
