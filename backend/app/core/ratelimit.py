"""Fixed-window rate limits in Redis (spec §8). Falls back to process memory when Redis is unreachable
(tests and single-process dev); the defence stack always has Redis."""
from __future__ import annotations

import threading
import time

from fastapi import HTTPException

from app.config import settings

_lock = threading.Lock()
_memory: dict[str, tuple[int, float]] = {}
_redis = None


def _client():
    global _redis
    if _redis is None:
        try:
            import redis

            _redis = redis.Redis.from_url(settings.REDIS_URL, socket_connect_timeout=0.3, socket_timeout=0.3)
            _redis.ping()
        except Exception:  # noqa: BLE001
            _redis = False
    return _redis or None


def hit(key: str, limit: int, window_s: int) -> int:
    """Count one request; return the count in the current window."""
    bucket = int(time.time() // window_s)
    full = f"rl:{key}:{bucket}"
    r = _client()
    if r is not None:
        try:
            pipe = r.pipeline()
            pipe.incr(full)
            pipe.expire(full, window_s + 1)
            return int(pipe.execute()[0])
        except Exception:  # noqa: BLE001
            pass
    with _lock:
        count, exp = _memory.get(full, (0, time.time() + window_s))
        count += 1
        _memory[full] = (count, exp)
        for k in [k for k, (_, e) in _memory.items() if e < time.time()]:
            _memory.pop(k, None)
        return count


def enforce(key: str, limit: int, window_s: int, message: str = "Too many requests. Please wait a minute.") -> None:
    if hit(key, limit, window_s) > limit:
        raise HTTPException(status_code=429, detail=message)


def reset_memory() -> None:
    with _lock:
        _memory.clear()
