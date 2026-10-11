"""Enqueue background jobs (spec §2 "Worker jobs").

Jobs carry only IDs and use RQ's JSON serializer, never pickle (S1). With JOBS_INLINE=true the job
runs inside the request instead (tests, or a laptop run without the worker). If Redis is down the
report simply stays "pending"; the scheduler re-queues pending reports every few minutes.
"""
from __future__ import annotations

import logging

from app.config import settings

log = logging.getLogger("civicpulse.queue")
QUEUE_NAME = "civicpulse"
_queue = None


def _get_queue():
    global _queue
    if _queue is None:
        import redis
        from rq import Queue
        from rq.serializers import JSONSerializer

        conn = redis.Redis.from_url(settings.REDIS_URL, socket_connect_timeout=1, socket_timeout=5)
        _queue = Queue(QUEUE_NAME, connection=conn, serializer=JSONSerializer)
    return _queue


def enqueue(job: str, *args: str) -> bool:
    """`job` is a function name in app.worker.jobs; every argument must be a plain string.
    The caller must commit before calling, because the job opens its own database session."""
    if any(not isinstance(a, str) for a in args):
        raise TypeError("job arguments must be strings (IDs only)")
    from app.worker import jobs

    if not hasattr(jobs, job):
        raise ValueError(f"unknown job {job}")
    if settings.JOBS_INLINE:
        getattr(jobs, job)(*args)
        return True
    try:
        _get_queue().enqueue(f"app.worker.jobs.{job}", *args, job_timeout=600, result_ttl=3600, failure_ttl=86400)
        return True
    except Exception:  # noqa: BLE001
        log.exception("could not enqueue %s%s; it will be retried by the scheduler", job, args)
        return False
