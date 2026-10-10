"""Beta evidence model: F0–F4 (fusion), F20 (conflict) and the status rules (spec §1).

alpha and beta are the stored source of truth; every other number is derived here.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from app.scoring.params import Params


class Status(str, Enum):
    STRONGLY_SUPPORTED = "strongly_supported"
    SUPPORTED = "supported"
    UNCERTAIN = "uncertain"
    NOT_SUPPORTED = "not_supported"


SUPPORTIVE = (Status.STRONGLY_SUPPORTED, Status.SUPPORTED)

PRIOR_ALPHA = 1.0  # F0
PRIOR_BETA = 1.0


def credibility(alpha: float, beta: float) -> float:
    """F1: c = α / (α + β)."""
    return alpha / (alpha + beta)


def uncertainty(alpha: float, beta: float) -> float:
    """F2: u = 12·αβ / ((α+β)²(α+β+1)). Beta variance × 12, so Beta(1,1) gives exactly 1."""
    s = alpha + beta
    return 12.0 * alpha * beta / (s * s * (s + 1.0))


def evidence(score: float, weight: float) -> tuple[float, float]:
    """F3: e⁺ = w·max(0, 2s−1), e⁻ = w·max(0, 1−2s). A score of 0.5 adds nothing."""
    if not 0.0 <= score <= 1.0:
        raise ValueError(f"component score must be in [0, 1], got {score}")
    return weight * max(0.0, 2.0 * score - 1.0), weight * max(0.0, 1.0 - 2.0 * score)


def belief(alpha: float, beta: float) -> float:
    """Jøsang belief b = (α−1)/(α+β); 0 for a brand-new Beta(1,1) (F13, F22)."""
    return (alpha - 1.0) / (alpha + beta)


def conflict(alpha: float, beta: float, agree: float, disagree: float) -> float:
    """F20: κ = max(κ_ev, κ_comm).

    κ_ev = 4·b·d from subjective logic; κ_comm = 4p(1−p)·(A+D)/(A+D+2) from the votes.
    """
    r, s = alpha - PRIOR_ALPHA, beta - PRIOR_BETA
    b = r / (r + s + 2.0)
    d = s / (r + s + 2.0)
    k_ev = 4.0 * b * d
    total = agree + disagree
    if total <= 0:
        return k_ev
    p = agree / total
    k_comm = 4.0 * p * (1.0 - p) * total / (total + 2.0)
    return max(k_ev, k_comm)


@dataclass(frozen=True)
class Decision:
    status: Status
    rule: str          # which rule decided it, stored in scoring_runs.gates
    gate_applied: bool  # True when the gate turned a supportive result into Uncertain


def decide_status(
    c: float,
    u: float,
    kappa: float,
    params: Params,
    *,
    corroborations: int,
    reporter_rep: float | None,
    reporter_rep_u: float | None,
    allow_reputation_gate: bool,
) -> Decision:
    """Status rules in the exact spec order, then the gate.

    The judging status passes allow_reputation_gate=False: only real corroboration
    can open the gate (N4).
    """
    st = params.status
    if kappa >= st.conflict_threshold:
        return Decision(Status.UNCERTAIN, "1_conflict", False)
    if c >= st.strongly_supported.min_credibility and u <= st.strongly_supported.max_uncertainty:
        result, rule = Status.STRONGLY_SUPPORTED, "2_strongly_supported"
    elif c >= st.supported.min_credibility and u <= st.supported.max_uncertainty:
        result, rule = Status.SUPPORTED, "3_supported"
    elif c < st.not_supported_max_credibility:
        return Decision(Status.NOT_SUPPORTED, "4_not_supported", False)
    else:
        return Decision(Status.UNCERTAIN, "5_otherwise", False)

    trusted_reporter = (
        allow_reputation_gate
        and reporter_rep is not None
        and reporter_rep_u is not None
        and reporter_rep >= st.gate_reputation.min_rep
        and reporter_rep_u <= st.gate_reputation.max_uncertainty
    )
    if st.gate_enabled and corroborations == 0 and not trusted_reporter:
        return Decision(Status.UNCERTAIN, rule + "+gate", True)
    return Decision(result, rule, False)


def needs_more_verification(c: float, u: float, kappa: float, params: Params) -> bool:
    """`requires_more_verification`: u ≥ 1.5·c or κ ≥ θ_c, on displayed values (T1, V1)."""
    return u >= params.flags.needs_verification_ratio * c or kappa >= params.status.conflict_threshold


def should_auto_hide(age_days: float, flagged: bool, u: float, params: Params) -> bool:
    """Auto-hide: still flagged after the window and u ≥ 0.80 (T1, V1)."""
    return flagged and age_days >= params.flags.auto_hide_after_days and u >= params.flags.auto_hide_uncertainty
