"""Emerging-issue alerts: exact conditional C-test (F29a), negative binomial switch
(F29b), Bonferroni correction and minimum count (spec §1, K11, L14, P8)."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Mapping, Sequence

import numpy as np
from scipy import stats

from app.scoring.params import Params


@dataclass(frozen=True)
class Baseline:
    observed: int          # x: count on the test day
    total: int             # N: count over the live baseline days
    live_days: int         # D
    daily_counts: tuple[int, ...]


@dataclass(frozen=True)
class AlertResult:
    ward_id: str
    category: str
    test_date: date
    observed: int
    baseline_n: int
    baseline_days: int
    p_value: float | None
    test: str                  # "c_test" | "negative_binomial" | "insufficient"
    alert: bool


def build_baseline(counts: Mapping[date, int], live_days: set[date], test_day: date, params: Params) -> Baseline:
    """Days t−29 … t−2 (28-day baseline, 2-day guard band). Only live days count; others are "no data"."""
    a = params.alerts
    days = [test_day - timedelta(days=a.guard_days + i) for i in range(a.baseline_days)]
    live = [d for d in days if d in live_days]
    daily = tuple(int(counts.get(d, 0)) for d in live)
    return Baseline(int(counts.get(test_day, 0)), int(sum(daily)), len(live), daily)


def c_test_p(x: int, n: int, d: int) -> float:
    """F29a: p = P(X ≥ x), X ~ Binomial(x + N, 1/(D+1))."""
    if x <= 0:
        return 1.0
    return float(stats.binom.sf(x - 1, x + n, 1.0 / (d + 1)))


def nb_p(x: int, n: int, d: int, dispersion: float) -> float:
    """F29b: NB(r = λ̂/(φ−1), p = 1/φ) with λ̂ = (N + 0.5)/D, so the mean is λ̂ and the variance λ̂φ."""
    if x <= 0:
        return 1.0
    lam = (n + 0.5) / d
    r = lam / (dispersion - 1.0)
    return float(stats.nbinom.sf(x - 1, r, 1.0 / dispersion))


def dispersion_by_category(baselines: Mapping[tuple[str, str], Baseline]) -> dict[str, float]:
    """Pooled variance / mean of baseline daily counts per category across wards."""
    pooled: dict[str, list[int]] = {}
    for (_, category), b in baselines.items():
        pooled.setdefault(category, []).extend(b.daily_counts)
    out = {}
    for category, values in pooled.items():
        arr = np.asarray(values, dtype=float)
        mean = arr.mean() if arr.size else 0.0
        out[category] = float(arr.var(ddof=1) / mean) if arr.size > 1 and mean > 0 else 1.0
    return out


def run_alerts(baselines: Mapping[tuple[str, str], Baseline], test_day: date, params: Params) -> list[AlertResult]:
    """Test every ward × category; Bonferroni over the tests actually run that day."""
    a = params.alerts
    phi = dispersion_by_category(baselines)
    testable = {k: b for k, b in baselines.items() if b.live_days >= a.min_live_days}
    m = max(1, len(testable))
    results = []
    for (ward, category), b in sorted(baselines.items()):
        if b.live_days < a.min_live_days:
            results.append(AlertResult(ward, category, test_day, b.observed, b.total, b.live_days, None, "insufficient", False))
            continue
        if phi.get(category, 1.0) > a.overdispersion_switch:
            p, test = nb_p(b.observed, b.total, b.live_days, phi[category]), "negative_binomial"
        else:
            p, test = c_test_p(b.observed, b.total, b.live_days), "c_test"
        alert = b.observed >= a.min_count and p < a.alpha / m
        results.append(AlertResult(ward, category, test_day, b.observed, b.total, b.live_days, p, test, alert))
    return results


def rank_alerts(alerts: Sequence[AlertResult], mean_credibility: Mapping[tuple[str, str], float]) -> list[AlertResult]:
    """Trust is used only to rank alerts, never inside the test (K11)."""
    fired = [a for a in alerts if a.alert]
    return sorted(fired, key=lambda a: mean_credibility.get((a.ward_id, a.category), 0.0), reverse=True)
