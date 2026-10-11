"""Full scoring run for one report: displayed status, judging status, flags and
reputation outcomes (spec §1 "Displayed status and judging status", W5).

The caller (the worker) computes the report-only components (text, image, GPS,
metadata, history) and passes the community inputs; this module does the rest.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Sequence

from app.scoring import beta as B
from app.scoring.components import (
    ComponentResult,
    Vote,
    community_civic_component,
    reputation_component,
)
from app.scoring.params import COMPONENTS, Params

View = Literal["displayed", "judging"]
Outcome = Literal["report_positive", "report_negative", "vote_agree", "vote_disagree"]


@dataclass(frozen=True)
class ComponentRow:
    """One trust_scores row."""
    name: str
    availability: str
    score: float | None
    weight: float
    pos_ev: float
    neg_ev: float
    explanation: str


@dataclass(frozen=True)
class ViewResult:
    view: View
    alpha: float
    beta: float
    credibility: float
    uncertainty: float
    conflict: float
    status: B.Status
    rule: str
    gate_applied: bool
    components_used: int
    rows: tuple[ComponentRow, ...]


@dataclass(frozen=True)
class ScoreResult:
    displayed: ViewResult
    judging: ViewResult
    flags: tuple[str, ...]
    reporter_outcome: Outcome | None
    voter_outcomes: dict[str, Outcome | None] = field(default_factory=dict)  # vote key -> outcome


@dataclass(frozen=True)
class CivicInputs:
    text: ComponentResult
    image: ComponentResult
    gps: ComponentResult
    metadata: ComponentResult
    history_displayed: ComponentResult
    history_judging: ComponentResult      # same query without the reporter's own past reports (N4)
    reporter_rep: float | None
    reporter_rep_u: float | None
    votes: Sequence[Vote] = ()
    corroboration_bases: Sequence[float] = ()   # base credibility of same-event reports by other users/devices


@dataclass(frozen=True)
class PriceInputs:
    gps: ComponentResult
    metadata: ComponentResult
    community: ComponentResult              # from community_price_component
    reporter_rep: float | None
    reporter_rep_u: float | None
    corroborated: bool


def fuse(components: dict[str, ComponentResult], params: Params) -> tuple[float, float, int, tuple[ComponentRow, ...]]:
    """F3–F4 over the available components."""
    weights = params.evidence.weights()
    alpha, beta_ = B.PRIOR_ALPHA, B.PRIOR_BETA
    rows = []
    used = 0
    for name in COMPONENTS:
        comp = components.get(name) or ComponentResult.unavailable(name, "Not applicable")
        w = weights[name]
        if comp.availability == "unavailable" or comp.score is None:
            rows.append(ComponentRow(name, "unavailable", None, w, 0.0, 0.0, comp.explanation))
            continue
        if name == "community" and params.evidence.community_mode == "direct" and "agree" in comp.extra:
            # F-1: each weighted vote (and corroboration weight) is direct Beta evidence.
            e_pos, e_neg = w * comp.extra["agree"], w * comp.extra["disagree"]
        else:
            e_pos, e_neg = B.evidence(comp.score, w)
        alpha += e_pos
        beta_ += e_neg
        used += 1
        rows.append(ComponentRow(name, comp.availability, comp.score, w, e_pos, e_neg, comp.explanation))
    return alpha, beta_, used, tuple(rows)


def _view(view: View, components: dict[str, ComponentResult], params: Params, *, agree: float, disagree: float,
          corroborations: int, rep: float | None, rep_u: float | None) -> ViewResult:
    alpha, beta_, used, rows = fuse(components, params)
    c, u = B.credibility(alpha, beta_), B.uncertainty(alpha, beta_)
    kappa = B.conflict(alpha, beta_, agree, disagree)
    decision = B.decide_status(
        c, u, kappa, params, corroborations=corroborations, reporter_rep=rep, reporter_rep_u=rep_u,
        allow_reputation_gate=(view == "displayed"),
    )
    return ViewResult(view, alpha, beta_, c, u, kappa, decision.status, decision.rule, decision.gate_applied, used, rows)


def _reporter_outcome(status: B.Status) -> Outcome | None:
    if status in B.SUPPORTIVE:
        return "report_positive"
    if status == B.Status.NOT_SUPPORTED:
        return "report_negative"
    return None


def _on_spot_corroborations(votes: Sequence[Vote]) -> int:
    """K8: on-the-spot "Issue confirmed" votes from distinct users and devices."""
    seen_users, seen_devices = set(), set()
    for v in votes:
        if v.mode == "on_spot" and v.decision == "confirm" and v.voter_id not in seen_users and v.device_id not in seen_devices:
            seen_users.add(v.voter_id)
            seen_devices.add(v.device_id)
    return len(seen_users)


def _civic_judging(inp: CivicInputs, votes: Sequence[Vote], params: Params) -> ViewResult:
    community = community_civic_component(votes, inp.corroboration_bases, params.votes.mode_weights)
    comps = {
        "text": inp.text, "image": inp.image, "gps": inp.gps, "metadata": inp.metadata,
        "reputation": reputation_component(inp.reporter_rep, include=False),
        "community": community, "history": inp.history_judging,
    }
    real = _on_spot_corroborations(votes) + sum(1 for c in inp.corroboration_bases if c >= 0.5)
    return _view("judging", comps, params, agree=community.extra["agree"], disagree=community.extra["disagree"],
                 corroborations=real, rep=None, rep_u=None)


def score_civic(inp: CivicInputs, params: Params) -> ScoreResult:
    votes = list(inp.votes)
    community = community_civic_component(votes, inp.corroboration_bases, params.votes.mode_weights)
    corroborations = _on_spot_corroborations(votes) + sum(1 for c in inp.corroboration_bases if c >= 0.5)
    displayed_comps = {
        "text": inp.text, "image": inp.image, "gps": inp.gps, "metadata": inp.metadata,
        "reputation": reputation_component(inp.reporter_rep),
        "community": community, "history": inp.history_displayed,
    }
    displayed = _view("displayed", displayed_comps, params, agree=community.extra["agree"],
                      disagree=community.extra["disagree"], corroborations=corroborations,
                      rep=inp.reporter_rep, rep_u=inp.reporter_rep_u)
    judging = _civic_judging(inp, votes, params)

    flags = []
    if inp.image.extra.get("category_mismatch"):
        flags.append("category_mismatch")
    if B.needs_more_verification(displayed.credibility, displayed.uncertainty, displayed.conflict, params):
        flags.append("requires_more_verification")

    return ScoreResult(displayed, judging, tuple(flags), _reporter_outcome(judging.status),
                       _voter_outcomes(inp, votes, params))


def vote_key(v: Vote) -> str:
    return f"{v.voter_id}:{v.device_id}"


def _voter_outcomes(inp: CivicInputs, votes: Sequence[Vote], params: Params) -> dict[str, Outcome | None]:
    """Leave-one-out judging for each on-the-spot voter (L2, V5, rule 5 under Reputation)."""
    out: dict[str, Outcome | None] = {}
    k = params.votes.consensus_k
    for v in votes:
        if v.mode != "on_spot" or v.decision == "fixed_now":
            continue  # only on-spot confirm/disagree votes earn or lose voter reputation
        others = [o for o in votes if o is not v]
        other_on_spot = [o for o in others if o.mode == "on_spot" and o.decision != "fixed_now"]
        if len(other_on_spot) < k:
            out[vote_key(v)] = None
            continue
        loo = _civic_judging(inp, others, params)
        if loo.status == B.Status.UNCERTAIN:
            out[vote_key(v)] = None
        elif (v.decision == "confirm") == (loo.status in B.SUPPORTIVE):
            out[vote_key(v)] = "vote_agree"
        else:
            out[vote_key(v)] = "vote_disagree"
    return out


def score_price(inp: PriceInputs, params: Params, *, history_flag: bool = False) -> ScoreResult:
    """Price reports: GPS, metadata, reputation and community only; text, image and history add nothing (K10, T9)."""
    unavailable = {
        "text": ComponentResult.unavailable("text", "Not used for prices"),
        "image": ComponentResult.unavailable("image", "Price photos are stored, not scored"),
        "history": ComponentResult.unavailable("history", "Flag-only for prices"),
    }
    corroborations = 1 if inp.corroborated else 0
    agree = inp.community.extra.get("agree", 0.0)
    disagree = inp.community.extra.get("disagree", 0.0)
    displayed = _view("displayed", {**unavailable, "gps": inp.gps, "metadata": inp.metadata,
                                    "reputation": reputation_component(inp.reporter_rep), "community": inp.community},
                      params, agree=agree, disagree=disagree, corroborations=corroborations,
                      rep=inp.reporter_rep, rep_u=inp.reporter_rep_u)
    judging = _view("judging", {**unavailable, "gps": inp.gps, "metadata": inp.metadata,
                                "reputation": reputation_component(inp.reporter_rep, include=False),
                                "community": inp.community},
                    params, agree=agree, disagree=disagree, corroborations=corroborations, rep=None, rep_u=None)
    flags = []
    if B.needs_more_verification(displayed.credibility, displayed.uncertainty, displayed.conflict, params):
        flags.append("requires_more_verification")
    return ScoreResult(displayed, judging, tuple(flags), _reporter_outcome(judging.status), {})


def base_credibility(components: dict[str, ComponentResult], params: Params, *, price: bool = False) -> float:
    """c_base for corroboration weights (F14, R27): text, image, GPS, metadata only (price: GPS, metadata)."""
    keep = ("gps", "metadata") if price else ("text", "image", "gps", "metadata")
    subset = {k: v for k, v in components.items() if k in keep}
    alpha, beta_, _, _ = fuse(subset, params)
    return B.credibility(alpha, beta_)


def with_profile(params: Params, weights: dict[str, float]) -> Params:
    """Copy of params using profile B weights (results chapter only)."""
    ev = params.evidence.model_copy(update={"weight_profile": "B", "weights_b": dict(weights)})
    return params.model_copy(update={"evidence": ev})
