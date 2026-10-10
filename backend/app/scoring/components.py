"""The seven evidence components, F5–F19 (spec §1 "The seven evidence components").

Every function is pure: the worker gathers the inputs (embeddings, GPS, votes,
nearby history) and these functions turn them into a score in [0, 1].
A component that has no input returns availability "unavailable" and no score;
missing evidence is never treated as a score of 0 (C5, R6).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Iterable, Literal, Sequence

import numpy as np

from app.scoring.beta import SUPPORTIVE, Status, belief

Availability = Literal["available", "partial", "unavailable"]
VoteMode = Literal["on_spot", "same_ward", "far_away"]
VoteDecision = Literal["confirm", "disagree", "fixed_now"]


@dataclass(frozen=True)
class ComponentResult:
    name: str
    availability: Availability
    score: float | None
    explanation: str
    extra: dict = field(default_factory=dict)

    @staticmethod
    def unavailable(name: str, why: str) -> "ComponentResult":
        return ComponentResult(name, "unavailable", None, why)


# ---------- F5–F6: text and the chance-anchored rescale ----------

def chance_anchored(p: float, n: int) -> float:
    """F6: map a softmax probability so that pure guessing (1/N) becomes 0.5."""
    if n < 2:
        raise ValueError("N must be at least 2")
    if not 0.0 <= p <= 1.0:
        raise ValueError(f"probability must be in [0, 1], got {p}")
    chance = 1.0 / n
    if p >= chance:
        return 0.5 + 0.5 * (p - chance) / (1.0 - chance)
    return 0.5 * p * n


def softmax_probability(query: Sequence[float], prototypes: np.ndarray, chosen: int, temperature: float) -> float:
    """F5: softmax over cos(t, q_j)/τ, returning the probability of the chosen category."""
    t = np.asarray(query, dtype=float)
    q = np.asarray(prototypes, dtype=float)
    t = t / np.linalg.norm(t)
    q = q / np.linalg.norm(q, axis=1, keepdims=True)
    logits = (q @ t) / temperature
    logits -= logits.max()
    probs = np.exp(logits)
    probs /= probs.sum()
    return float(probs[chosen])


def text_component(p_chosen: float | None, n_categories: int) -> ComponentResult:
    if p_chosen is None:
        return ComponentResult.unavailable("text", "No description embedding")
    s = chance_anchored(p_chosen, n_categories)
    return ComponentResult("text", "available", s, f"Category probability {p_chosen:.2f} over {n_categories} categories")


def image_component(p_chosen: float | None, n_prompts: int, mismatch_threshold: float) -> ComponentResult:
    """F7: CLIP probability of the chosen category over K+1 prompts (K categories + unrelated scene)."""
    if p_chosen is None:
        return ComponentResult.unavailable("image", "No photo score")
    s = chance_anchored(p_chosen, n_prompts)
    mismatch = s < mismatch_threshold
    why = f"CLIP probability {p_chosen:.2f} over {n_prompts} prompts"
    if mismatch:
        why += "; image may not match the category"
    return ComponentResult("image", "available", s, why, {"category_mismatch": mismatch})


# ---------- F8–F10: GPS ----------

def accuracy_score(accuracy_m: float, limit_m: float) -> float:
    """F8: 1 within the accuracy limit, then limit/accuracy."""
    if accuracy_m < 0:
        raise ValueError("GPS accuracy cannot be negative")
    return 1.0 if accuracy_m <= limit_m else limit_m / accuracy_m


def gps_civic_component(accuracy_m: float | None, limit_m: float) -> ComponentResult:
    """F9: civic GPS credibility comes from accuracy alone (K9)."""
    if accuracy_m is None:
        return ComponentResult.unavailable("gps", "No GPS fix")
    s_acc = accuracy_score(accuracy_m, limit_m)
    rel = "≤" if accuracy_m <= limit_m else ">"
    return ComponentResult("gps", "available", 0.5 + 0.5 * s_acc, f"Accuracy {accuracy_m:.0f} m {rel} {limit_m:.0f} m")


def gps_price_component(accuracy_m: float | None, distance_to_market_m: float | None,
                        market_radius_m: float, limit_m: float) -> ComponentResult:
    """F10: price GPS rewards being inside the market radius. GPS is optional for prices (P-1)."""
    if accuracy_m is None or distance_to_market_m is None:
        return ComponentResult.unavailable("gps", "GPS not shared (optional for prices)")
    s_acc = accuracy_score(accuracy_m, limit_m)
    inside = 1.0 if distance_to_market_m <= market_radius_m else 0.0
    where = "inside" if inside else "outside"
    return ComponentResult(
        "gps", "available", 0.5 + 0.5 * s_acc * (2.0 * inside - 1.0),
        f"{distance_to_market_m:.0f} m from the market, {where} its {market_radius_m:.0f} m radius",
    )


# ---------- F11: metadata ----------

def metadata_component(capture_to_post_seconds: float | None, token_minutes: float) -> ComponentResult:
    """F11 with U20: gap = post time − capture time (the capture time is fixed at first capture)."""
    if capture_to_post_seconds is None:
        return ComponentResult.unavailable("metadata", "No in-app capture")
    limit = token_minutes * 60.0
    if capture_to_post_seconds < 0:
        raise ValueError("post time cannot be before capture time")
    if capture_to_post_seconds > limit:
        raise ValueError("capture is older than the token lifetime; the upload must be rejected")
    s = 1.0 - 0.5 * capture_to_post_seconds / limit
    return ComponentResult("metadata", "available", s, f"Posted {capture_to_post_seconds / 60:.1f} min after capture")


# ---------- F12: reputation ----------

def reputation_component(reporter_rep: float | None, *, include: bool = True) -> ComponentResult:
    """F12. The judging status leaves this component out entirely (N6)."""
    if not include:
        return ComponentResult.unavailable("reputation", "Left out of the judging status")
    if reporter_rep is None:
        return ComponentResult.unavailable("reputation", "Reporter unavailable")
    return ComponentResult("reputation", "available", reporter_rep, f"Reporter reputation {reporter_rep:.2f}")


# ---------- F13–F16: community (civic) ----------

@dataclass(frozen=True)
class Vote:
    voter_id: str
    device_id: str
    mode: VoteMode            # the server-verified mode (V2)
    decision: VoteDecision
    voter_alpha: float        # voter's decayed reputation Beta at scoring time
    voter_beta: float


def vote_weight(vote: Vote, mode_weights: dict[str, float]) -> float:
    """F13: v = m_mode · b_voter."""
    return mode_weights[vote.mode] * max(0.0, belief(vote.voter_alpha, vote.voter_beta))


def corroboration_weight(base_credibility: float) -> float:
    """F14: ρ = max(0, 2·c_base − 1); c_base uses text, image, GPS and metadata only (R27)."""
    return max(0.0, 2.0 * base_credibility - 1.0)


def smoothed(agree: float, disagree: float) -> float:
    """F16: (A + 1) / (A + D + 2), the Beta(1,1)-smoothed agreement."""
    return (agree + 1.0) / (agree + disagree + 2.0)


def community_civic_component(votes: Iterable[Vote], corroboration_bases: Iterable[float],
                              mode_weights: dict[str, float]) -> ComponentResult:
    """F15–F16. "Fixed now" votes never enter A or D (N3)."""
    agree = disagree = 0.0
    n_votes = 0
    for v in votes:
        if v.decision == "fixed_now":
            continue
        w = vote_weight(v, mode_weights)
        n_votes += 1
        if v.decision == "confirm":
            agree += w
        else:
            disagree += w
    rhos = [corroboration_weight(c) for c in corroboration_bases]
    agree += sum(rhos)
    extra = {"agree": agree, "disagree": disagree}
    if agree + disagree <= 0:
        why = "No weighted votes yet" if not n_votes and not rhos else "Votes so far carry no weight (new accounts)"
        return ComponentResult("community", "unavailable", None, why, extra)
    return ComponentResult(
        "community", "available", smoothed(agree, disagree),
        f"Weighted agree {agree:.2f}, disagree {disagree:.2f} ({n_votes} votes, {len(rhos)} corroborating reports)",
        extra,
    )


# ---------- F17: community (price) ----------

def community_price_component(price: float, others: Sequence[tuple[float, float]], tolerance: float) -> ComponentResult:
    """F17 + F16. `others` = (price, base credibility ρ) of the other reports in the same cell.

    The median x̃ is taken over the whole group, including this report.
    """
    if not others:
        return ComponentResult.unavailable("community", "No other reports in this product, market and day")
    median = float(np.median([price] + [p for p, _ in others]))
    agree = disagree = 0.0
    n_agree = 0
    for other_price, rho in others:
        if abs(price - other_price) / median <= tolerance:
            agree += rho
            n_agree += 1
        else:
            disagree += rho
    extra = {"agree": agree, "disagree": disagree, "corroborated": n_agree > 0}
    if agree + disagree <= 0:
        return ComponentResult("community", "unavailable", None, "Other reports carry no weight yet", extra)
    return ComponentResult(
        "community", "available", smoothed(agree, disagree),
        f"{n_agree} of {len(others)} other reports within {tolerance:.0%} of the median ৳{median:.2f}", extra,
    )


# ---------- F18–F19: history (civic) ----------

@dataclass(frozen=True)
class PastReport:
    judging_status: Status
    age_days: float


def history_component(past: Iterable[PastReport], half_life_days: float) -> ComponentResult:
    """F18–F19 over same-category reports within the radius and window (filtered by the caller)."""
    h_pos = h_neg = 0.0
    n = 0
    for r in past:
        h = 2.0 ** (-r.age_days / half_life_days)
        if r.judging_status in SUPPORTIVE:
            h_pos += h
            n += 1
        elif r.judging_status == Status.NOT_SUPPORTED:
            h_neg += h
            n += 1
    if n == 0:
        return ComponentResult.unavailable("history", "No past reports nearby")
    return ComponentResult(
        "history", "available", smoothed(h_pos, h_neg),
        f"{n} past reports nearby (decayed supported {h_pos:.2f}, not supported {h_neg:.2f})",
    )


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres (used by tests and the hotspot code)."""
    r = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))
