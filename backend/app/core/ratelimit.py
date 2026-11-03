"""In-process sliding-window limiter for failed logins.

Single-instance only. A multi-instance deployment needs a shared store (for example Redis).
See docs/SECURITY_REVIEW.md.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque


class SlidingWindow:
    def __init__(self, limit: int, window_seconds: int):
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def _prune(self, key: str, now: float) -> deque[float]:
        q = self._hits[key]
        while q and now - q[0] > self.window:
            q.popleft()
        return q

    def blocked(self, key: str) -> int:
        """Seconds until the key may try again, or 0."""
        now = time.monotonic()
        with self._lock:
            q = self._prune(key, now)
            if len(q) >= self.limit:
                return int(self.window - (now - q[0])) + 1
            return 0

    def hit(self, key: str) -> None:
        with self._lock:
            self._hits[key].append(time.monotonic())

    def reset(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)


failed_logins_by_email = SlidingWindow(limit=5, window_seconds=15 * 60)
failed_logins_by_ip = SlidingWindow(limit=50, window_seconds=15 * 60)
