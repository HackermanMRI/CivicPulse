"""Scheduler loop (open parameter B12: a small Python loop, not the beta RQ CronScheduler).

Every minute: mark today live. Every 5 minutes: re-queue lost pending reports. Every hour: auto-hide
check. Daily at 12:10 AM Asia/Dhaka: alerts for yesterday, hotspots and the collusion scan. Hotspots
and the collusion scan also run once at start-up so the dashboard has data right away.

Run with:  python -m app.worker.scheduler
"""
from __future__ import annotations

import logging
import signal
import time
from datetime import datetime

from app.core.timeutil import DHAKA
from app.worker.queue import enqueue

log = logging.getLogger("civicpulse.scheduler")
_stop = False


def _handle(_sig, _frame):
    global _stop
    _stop = True


def due_jobs(now: datetime, last: dict[str, str]) -> list[str]:
    """Pure helper (tested): which jobs are due at `now` (Dhaka time), given the last-run markers."""
    due = []
    stamps = {
        "mark_live": now.strftime("%Y-%m-%d %H:%M"),
        "requeue_pending": now.strftime("%Y-%m-%d %H:") + str(now.minute // 5),
        "auto_hide": now.strftime("%Y-%m-%d %H"),
    }
    for job, stamp in stamps.items():
        if last.get(job) != stamp:
            due.append(job)
            last[job] = stamp
    if (now.hour, now.minute) >= (0, 10):
        day = now.strftime("%Y-%m-%d")
        for job in ("daily_alerts", "daily_hotspots", "collusion_scan"):
            if last.get(job) != day:
                due.append(job)
                last[job] = day
    return due


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    signal.signal(signal.SIGTERM, _handle)
    signal.signal(signal.SIGINT, _handle)
    last: dict[str, str] = {}
    enqueue("daily_hotspots")
    enqueue("collusion_scan")
    while not _stop:
        for job in due_jobs(datetime.now(DHAKA), last):
            log.info("enqueue %s", job)
            enqueue(job)
        for _ in range(30):
            if _stop:
                break
            time.sleep(2)


if __name__ == "__main__":
    main()
