"""Hotspot pipeline, F27–F28 (spec §1 "Hotspots", L10, L11).

The caller applies the database filter (last 30 days, civic, visible, not resolved,
not Not Supported, no duplicate/suspicious flag). This module deduplicates,
clusters with unweighted DBSCAN, validates and scores.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Sequence

import numpy as np
from sklearn.cluster import DBSCAN

from app.scoring.components import haversine_m
from app.scoring.params import Params

EARTH_RADIUS_M = 6_371_000.0


@dataclass(frozen=True)
class HotspotReport:
    report_id: str
    user_id: str
    category: str
    day: date
    lat: float
    lon: float
    credibility: float
    age_days: float


@dataclass(frozen=True)
class Hotspot:
    category: str
    report_ids: tuple[str, ...]
    centroid: tuple[float, float]     # (lat, lon), trust-weighted
    score: float                      # 0–100
    s_severity: float
    v_volume: float
    c_compact: float
    t_trust: float
    n_reports: int
    n_users: int
    eps_m: float
    min_samples: int


def deduplicate(reports: Sequence[HotspotReport]) -> list[HotspotReport]:
    """Keep one report per (user, category, day): the most credible one (L10)."""
    best: dict[tuple[str, str, date], HotspotReport] = {}
    for r in reports:
        key = (r.user_id, r.category, r.day)
        if key not in best or r.credibility > best[key].credibility:
            best[key] = r
    return list(best.values())


def score_cluster(members: Sequence[HotspotReport], severity: float, params: Params) -> Hotspot:
    hp = params.hotspots
    eff = np.array([m.credibility * 0.5 ** (m.age_days / hp.half_life_days) for m in members])
    t = float(eff.sum())
    s = severity  # every member has the same category, so the weighted mean equals the category severity
    v = min(1.0, t / hp.t_ref)
    if t > 0:
        lat = float(np.dot(eff, [m.lat for m in members]) / t)
        lon = float(np.dot(eff, [m.lon for m in members]) / t)
    else:
        lat = float(np.mean([m.lat for m in members]))
        lon = float(np.mean([m.lon for m in members]))
    med = float(np.median([haversine_m(m.lat, m.lon, lat, lon) for m in members]))
    c = min(1.0, max(0.0, 1.0 - med / hp.eps_m))
    score = 100.0 * s * v * (0.5 + 0.5 * c)
    return Hotspot(members[0].category, tuple(m.report_id for m in members), (lat, lon), score, s, v, c, t,
                   len(members), len({m.user_id for m in members}), hp.eps_m, hp.min_samples)


def find_hotspots(reports: Sequence[HotspotReport], params: Params) -> list[Hotspot]:
    hp = params.hotspots
    reports = deduplicate(reports)
    out: list[Hotspot] = []
    for category in sorted({r.category for r in reports}):
        group = [r for r in reports if r.category == category]
        if len(group) < hp.min_samples:
            continue
        coords = np.radians([[r.lat, r.lon] for r in group])
        # Unweighted on purpose: scikit-learn sums sample weights in min_samples (L10).
        labels = DBSCAN(eps=hp.eps_m / EARTH_RADIUS_M, min_samples=hp.min_samples,
                        metric="haversine", algorithm="ball_tree").fit_predict(coords)
        severity = params.severity(category)
        for label in sorted(set(labels) - {-1}):
            members = [r for r, lab in zip(group, labels) if lab == label]
            if len(members) < hp.min_reports or len({m.user_id for m in members}) < hp.min_users:
                continue
            out.append(score_cluster(members, severity, params))
    return sorted(out, key=lambda h: h.score, reverse=True)
