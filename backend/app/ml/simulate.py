"""Synthetic experiments that need no pilot data (spec §4): E4 attacks, E5 feedback
loop and E10 alert false alarms. All randomness uses a fixed seed (reproducibility).
Results are synthetic and must always be reported separately from pilot results.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

import numpy as np

from app.scoring import alerts as A
from app.scoring.beta import SUPPORTIVE, Status
from app.scoring.components import (
    ComponentResult, Vote, gps_civic_component, image_component, metadata_component, text_component,
)
from app.scoring.engine import CivicInputs, score_civic
from app.scoring.params import Params
from app.scoring.prices import CellReport, verified_price
from app.scoring.reputation import RepEvent, event_delta, read_reputation

EPOCH = datetime(2026, 1, 1, tzinfo=timezone.utc)


def plausible_report(rep: float = 0.5, rep_u: float = 1.0, votes=(), params: Params | None = None) -> CivicInputs:
    """A report whose text, photo, GPS and timing all look normal; fake and real look alike."""
    none = ComponentResult.unavailable("history", "none nearby")
    return CivicInputs(
        text=text_component(0.55, 7), image=image_component(0.60, 8, 0.5),
        gps=gps_civic_component(12, 50), metadata=metadata_component(90, 10),
        history_displayed=none, history_judging=none, reporter_rep=rep, reporter_rep_u=rep_u, votes=tuple(votes),
    )


def _no_defence(params: Params) -> Params:
    """Every vote counts fully: no mode weights (and the caller gives voters belief ≈ 1)."""
    votes = params.votes.model_copy(update={"mode_weights": {"on_spot": 1.0, "same_ward": 1.0, "far_away": 1.0}})
    return params.model_copy(update={"votes": votes})


# ---------------- E4: attacks ----------------

def _no_gate(params: Params) -> Params:
    return params.model_copy(update={"status": params.status.model_copy(update={"gate_enabled": False})})


def sybil_attack(n_accounts: int, params: Params, defences: str = "all") -> Status:
    """n brand-new accounts vote "Issue confirmed" on a fake report from far away.
    defences: "all" | "no_weights" (no belief or mode weighting) | "none" (no weights and no gate)."""
    alpha = 1.0 if defences == "all" else 1e6  # without belief weighting a new account counts like a trusted one
    votes = [Vote(f"s{i}", f"sd{i}", "far_away", "confirm", alpha, 1.0) for i in range(n_accounts)]
    p = params if defences == "all" else _no_defence(params)
    if defences == "none":
        p = _no_gate(p)
    return score_civic(plausible_report(votes=votes), p).displayed.status


def vote_ring(ring_size: int, honest_disagree: int, params: Params, gps_spoofed: bool) -> Status:
    """A ring with built-up reputation Beta(5,1) confirms a fake report. Without GPS spoofing the
    server downgrades their claimed on-spot votes to far away (V2); honest on-spot voters disagree."""
    mode = "on_spot" if gps_spoofed else "far_away"
    ring = [Vote(f"r{i}", f"rd{i}", mode, "confirm", 5.0, 1.0) for i in range(ring_size)]
    honest = [Vote(f"h{i}", f"hd{i}", "on_spot", "disagree", 5.0, 1.0) for i in range(honest_disagree)]
    return score_civic(plausible_report(votes=ring + honest), params).displayed.status


def price_pumping(n_honest: int, n_attackers: int, params: Params, true_price: float = 95.0,
                  pumped_price: float = 150.0, seed: int = 7) -> dict:
    """Attackers (distinct accounts and devices) post a high price; their reports corroborate each
    other, so assume all reach Supported. The median is the only defence measured here."""
    rng = np.random.default_rng(seed)
    honest = [CellReport(f"h{i}", f"hu{i}", f"hd{i}", float(true_price + rng.normal(0, 2)), Status.SUPPORTED,
                         False, True, 0.8) for i in range(n_honest)]
    bad = [CellReport(f"a{i}", f"au{i}", f"ad{i}", pumped_price, Status.SUPPORTED, False, True, 0.8)
           for i in range(n_attackers)]
    v = verified_price(honest + bad, params)
    shift = None if v.value is None else 100.0 * (v.value - true_price) / true_price
    return {"verified": v.value, "status": v.status, "shift_percent": shift}


def run_e4(params: Params) -> dict:
    sup = lambda s: s in SUPPORTIVE  # noqa: E731
    return {
        "sybil": {n: {d: sup(sybil_attack(n, params, d)) for d in ("all", "no_weights", "none")} for n in (0, 5, 20)},
        "vote_ring": {k: {"no_spoof": sup(vote_ring(k, 2, params, False)), "gps_spoofed": sup(vote_ring(k, 2, params, True))}
                      for k in (3, 5, 8)},
        "price_pumping": {m: price_pumping(6, m, params) for m in (1, 3, 5, 7)},
    }


# ---------------- E5: feedback loop ----------------

@dataclass
class SimUser:
    uid: str
    kind: str                 # honest | exploiter (honest first, then fake)
    events: list


def _rep(user: SimUser, day: int, params: Params):
    return read_reputation(user.events, EPOCH + timedelta(days=day), params)


def feedback_loop(params: Params, *, split: bool, n_users: int = 30, exploiters: int = 6, days: int = 60,
                  turn_day: int = 30, p_votes: float = 0.4, voter_accuracy: float = 0.85, seed: int = 11) -> dict:
    """Each day every user posts one report. Exploiters behave honestly until `turn_day`, then post fakes.
    `split=True` uses the approved judging status (no reputation, real corroboration only);
    `split=False` judges with the displayed status, so reputation feeds itself."""
    rng = np.random.default_rng(seed)
    users = [SimUser(f"u{i}", "exploiter" if i < exploiters else "honest", []) for i in range(n_users)]
    honest_pool = [u for u in users if u.kind == "honest"]
    fake_supported = fake_total = 0
    trace = []
    for day in range(days):
        for u in users:
            is_fake = u.kind == "exploiter" and day >= turn_day
            votes = []
            if rng.random() < p_votes:
                voters = rng.choice(len(honest_pool), size=int(rng.integers(1, 5)), replace=False)
                for j in voters:
                    v_user = honest_pool[j]
                    if v_user is u:
                        continue
                    r = _rep(v_user, day, params)
                    correct = rng.random() < voter_accuracy
                    says_real = (not is_fake) if correct else is_fake
                    votes.append(Vote(v_user.uid, v_user.uid, "on_spot", "confirm" if says_real else "disagree", r.alpha, r.beta))
            rep = _rep(u, day, params)
            res = score_civic(plausible_report(rep.rep, rep.uncertainty, votes), params)
            status = res.judging.status if split else res.displayed.status
            when = EPOCH + timedelta(days=day)
            if status in SUPPORTIVE:
                u.events.append(RepEvent("report_positive", *event_delta("report_positive", params), when))
            elif status == Status.NOT_SUPPORTED:
                u.events.append(RepEvent("report_negative", *event_delta("report_negative", params), when))
            if is_fake:
                fake_total += 1
                fake_supported += res.displayed.status in SUPPORTIVE
        if day % 5 == 4:
            trace.append({
                "day": day + 1,
                "honest_rep": float(np.mean([_rep(x, day, params).rep for x in users if x.kind == "honest"])),
                "exploiter_rep": float(np.mean([_rep(x, day, params).rep for x in users if x.kind == "exploiter"])),
            })
    return {"split": split, "fake_reports": fake_total,
            "fake_shown_supported": fake_supported / fake_total if fake_total else 0.0, "trace": trace}


# ---------------- E10: alert false alarms ----------------

def false_alarm_rate(params: Params, *, overdispersed: bool, guard: bool, wards: int = 6, categories: int = 7,
                     days: int = 150, seed: int = 3) -> dict:
    """No real outbreaks are simulated, so every alert is a false alarm."""
    rng = np.random.default_rng(seed)
    p = params if guard else params.model_copy(update={"alerts": params.alerts.model_copy(update={"guard_days": 0})})
    start = date(2026, 1, 1)
    lam = rng.uniform(0.2, 1.5, size=(wards, categories))
    counts: dict[tuple[str, str], dict[date, int]] = {}
    for w in range(wards):
        for c in range(categories):
            if overdispersed:
                r = 1.0  # NB with dispersion 1 + λ/r
                series = rng.negative_binomial(r, r / (r + lam[w, c]), size=days)
            else:
                series = rng.poisson(lam[w, c], size=days)
            counts[(f"w{w}", f"c{c}")] = {start + timedelta(days=d): int(series[d]) for d in range(days)}
    live = {start + timedelta(days=d) for d in range(days)}
    alerts = tests = 0
    for d in range(40, days):
        t = start + timedelta(days=d)
        baselines = {k: A.build_baseline(v, live, t, p) for k, v in counts.items()}
        res = A.run_alerts(baselines, t, p)
        tests += sum(r.test != "insufficient" for r in res)
        alerts += sum(r.alert for r in res)
    return {"overdispersed": overdispersed, "guard": guard, "tests": tests, "alerts": alerts,
            "false_alarm_rate": alerts / tests if tests else 0.0,
            "family_alpha_per_day": params.alerts.alpha}


def run_e10(params: Params) -> list[dict]:
    return [false_alarm_rate(params, overdispersed=o, guard=g) for o in (False, True) for g in (True, False)]
