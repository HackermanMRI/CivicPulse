"""Pair-agreement check over all votes (spec §1 "Collusion", P5, L13, N10, X2).

A pair is flagged when at least two of three signals hold. Flags only create
admin alerts; reputation never changes automatically (P5, M7).
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from itertools import combinations
from statistics import median
from typing import Sequence

import numpy as np

from app.scoring.params import Params


@dataclass(frozen=True)
class VoteRow:
    voter_id: str
    report_id: str
    decision: str            # confirm | disagree | fixed_now
    mode: str                # verified mode
    created_at: datetime


@dataclass(frozen=True)
class PairStats:
    user_a: str
    user_b: str
    co_votes: int
    disputed_co_votes: int
    disputed_agreements: int
    median_gap_seconds: float


@dataclass(frozen=True)
class PairFlag:
    stats: PairStats
    signals: dict[str, bool]


def disputed_reports(votes: Sequence[VoteRow]) -> set[str]:
    """N10: at least one on-spot "Issue confirmed" and one on-spot "Disagree"."""
    confirm, disagree = set(), set()
    for v in votes:
        if v.mode == "on_spot":
            if v.decision == "confirm":
                confirm.add(v.report_id)
            elif v.decision == "disagree":
                disagree.add(v.report_id)
    return confirm & disagree


def pair_statistics(votes: Sequence[VoteRow]) -> list[PairStats]:
    by_report: dict[str, dict[str, VoteRow]] = defaultdict(dict)
    for v in votes:
        if v.decision == "fixed_now":
            continue
        by_report[v.report_id][v.voter_id] = v
    disputed = disputed_reports(votes)
    co = defaultdict(int)
    dco = defaultdict(int)
    dagree = defaultdict(int)
    gaps = defaultdict(list)
    for report_id, voters in by_report.items():
        for a, b in combinations(sorted(voters), 2):
            va, vb = voters[a], voters[b]
            co[(a, b)] += 1
            gaps[(a, b)].append(abs((va.created_at - vb.created_at).total_seconds()))
            if report_id in disputed:
                dco[(a, b)] += 1
                dagree[(a, b)] += int(va.decision == vb.decision)
    return [PairStats(a, b, co[(a, b)], dco[(a, b)], dagree[(a, b)], float(median(gaps[(a, b)]))) for a, b in co]


def flag_pairs(stats: Sequence[PairStats], params: Params) -> list[PairFlag]:
    if not stats:
        return []
    c = params.collusion
    co_cut = float(np.percentile([s.co_votes for s in stats], 100 - c.percentile))
    gap_cut = float(np.percentile([s.median_gap_seconds for s in stats], c.percentile))
    out = []
    for s in stats:
        signals = {
            "a_agreement": s.disputed_co_votes >= c.n_min and s.disputed_agreements / s.disputed_co_votes >= c.agreement,
            "b_co_votes_top": s.co_votes >= co_cut,
            "c_fast": s.median_gap_seconds <= gap_cut,
        }
        if sum(signals.values()) >= 2:
            out.append(PairFlag(s, signals))
    return out
