"""Price Patrol maths: verified price (F23), outliers (F24–F26), 7-day change (P-4)
and rise/drop alerts (P-2)."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Sequence

import numpy as np

from app.scoring.beta import SUPPORTIVE, Status
from app.scoring.params import Params


@dataclass(frozen=True)
class CellReport:
    report_id: str
    user_id: str
    device_id: str
    price: float
    status: Status
    duplicate: bool
    visible: bool
    credibility: float


@dataclass(frozen=True)
class VerifiedPrice:
    value: float | None
    status: str                 # "Verified" | "Insufficient Evidence"
    report_ids: tuple[str, ...]
    report_count: int


def eligible(reports: Sequence[CellReport]) -> list[CellReport]:
    """Q22/R30: credible+, not duplicate, visible, one per distinct user and device.

    If a user or device has several eligible reports in the cell, the most credible one is kept.
    """
    candidates = sorted(
        (r for r in reports if r.status in SUPPORTIVE and not r.duplicate and r.visible),
        key=lambda r: r.credibility, reverse=True,
    )
    users, devices, out = set(), set(), []
    for r in candidates:
        if r.user_id in users or r.device_id in devices:
            continue
        users.add(r.user_id)
        devices.add(r.device_id)
        out.append(r)
    return out


def verified_price(reports: Sequence[CellReport], params: Params) -> VerifiedPrice:
    """F23: median of at least `min_eligible_reports` eligible reports, else Insufficient Evidence."""
    chosen = eligible(reports)
    ids = tuple(r.report_id for r in chosen)
    if len(chosen) < params.prices.min_eligible_reports:
        return VerifiedPrice(None, "Insufficient Evidence", ids, len(chosen))
    return VerifiedPrice(float(np.median([r.price for r in chosen])), "Verified", ids, len(chosen))


def outlier_flags(prices: Sequence[float], params: Params) -> list[bool]:
    """F24–F26 over all visible reports in the cell. Outliers are flagged, never deleted."""
    n = len(prices)
    if n < 2:
        return [False] * n
    x = np.asarray(prices, dtype=float)
    med = float(np.median(x))
    p = params.prices
    if n >= p.small_n_switch:
        mad = float(np.median(np.abs(x - med)))
        floor = max(p.mad_floor_bdt, p.mad_floor_fraction * med)
        m = 0.6745 * (x - med) / max(mad, floor)
        return [bool(abs(v) > p.outlier_z) for v in m]
    return [bool(abs(v - med) / med > p.small_n_threshold) for v in x]


@dataclass(frozen=True)
class Change:
    percent: float
    from_date: date
    from_price: float
    to_date: date
    to_price: float


def seven_day_change(series: dict[date, float], today: date, params: Params) -> Change | None:
    """P-4: % change across a window of `change_window_days` consecutive days ending today.

    Uses the first and last days in the window that have a verified price; needs two such days.
    """
    start = today - timedelta(days=params.prices.change_window_days - 1)
    days = sorted(d for d in series if start <= d <= today)
    if len(days) < 2:
        return None
    first, last = days[0], days[-1]
    p0, p1 = series[first], series[last]
    return Change(100.0 * (p1 - p0) / p0, first, p0, last, p1)


def price_alert(change: Change | None, params: Params) -> str | None:
    """P-2: "rise" or "drop" when the 7-day change reaches ±alert_change_percent."""
    if change is None:
        return None
    if change.percent >= params.prices.alert_change_percent:
        return "rise"
    if change.percent <= -params.prices.alert_change_percent:
        return "drop"
    return None


def counts_toward_verified(report_id: str, verified: VerifiedPrice) -> bool:
    """UI "Counts toward verified price: Yes/No"."""
    return verified.status == "Verified" and report_id in verified.report_ids
