"""User reputation: events (P9), one current result per source (N2) and decay at read (F21–F22)."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Iterable

from app.scoring.beta import belief, credibility, uncertainty
from app.scoring.params import Params


@dataclass(frozen=True)
class RepEvent:
    kind: str              # report_positive | report_negative | duplicate | vote_agree | vote_disagree
    d_alpha: float
    d_beta: float
    occurred_at: datetime  # when the report or vote was made; decay counts from here (N2)


@dataclass(frozen=True)
class Reputation:
    alpha: float
    beta: float
    rep: float
    uncertainty: float
    belief: float


def event_delta(kind: str, params: Params) -> tuple[float, float]:
    """P9 increments. Negative evidence always goes to β; nothing is subtracted from α."""
    table = {
        "report_positive": params.reputation.report_positive,
        "report_negative": params.reputation.report_negative,
        "duplicate": params.reputation.duplicate,
        "vote_agree": params.reputation.vote_agree,
        "vote_disagree": params.reputation.vote_disagree,
    }
    if kind not in table:
        raise ValueError(f"unknown reputation event kind {kind!r}")
    d = table[kind]
    return d.d_alpha, d.d_beta


def read_reputation(events: Iterable[RepEvent], now: datetime, params: Params) -> Reputation:
    """F21: α_u = 1 + Σ Δα·0.5^(age/H), β_u likewise; F22: rep, u_rep, belief.

    `events` must be the current (not superseded) rows only.
    """
    h = params.reputation.half_life_days
    alpha = beta_ = 1.0
    for e in events:
        age_days = max(0.0, (now - e.occurred_at).total_seconds() / 86400.0)
        decay = 0.5 ** (age_days / h)
        alpha += e.d_alpha * decay
        beta_ += e.d_beta * decay
    return Reputation(alpha, beta_, credibility(alpha, beta_), uncertainty(alpha, beta_), belief(alpha, beta_))


def to_display(score_0_1: float | None) -> int | None:
    """C1: the server keeps 0–1; screens show ×100, rounded."""
    return None if score_0_1 is None else int(round(score_0_1 * 100))
